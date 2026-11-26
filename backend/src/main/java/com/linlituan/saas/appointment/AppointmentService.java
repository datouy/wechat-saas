package com.linlituan.saas.appointment;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlituan.saas.audit.AuditService;
import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.member.MemberRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

@Service
public class AppointmentService {
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private final AppointmentServiceRepository services;
    private final AppointmentRepository appointments;
    private final MemberRepository members;
    private final ObjectMapper objectMapper;
    private final AuditService audit;

    public AppointmentService(AppointmentServiceRepository services, AppointmentRepository appointments,
                              MemberRepository members, ObjectMapper objectMapper, AuditService audit) {
        this.services = services;
        this.appointments = appointments;
        this.members = members;
        this.objectMapper = objectMapper;
        this.audit = audit;
    }

    @Transactional
    public AppointmentServiceEntity create(Long tenantId, AppointmentDtos.ServiceRequest request) {
        AppointmentServiceEntity service = new AppointmentServiceEntity();
        service.setTenantId(tenantId);
        apply(service, request);
        services.save(service);
        audit.record("appointment-service.create", "appointment-service", String.valueOf(service.getId()),
                Map.of("name", service.getName(), "capacity", service.getCapacityPerSlot()));
        return service;
    }

    public List<AppointmentServiceEntity> services(Long tenantId) {
        return services.findByTenantIdOrderByCreatedAtDesc(tenantId);
    }

    @Transactional
    public AppointmentServiceEntity update(Long tenantId, Long id, AppointmentDtos.ServiceRequest request) {
        AppointmentServiceEntity service = getService(tenantId, id);
        apply(service, request);
        services.save(service);
        audit.record("appointment-service.update", "appointment-service", String.valueOf(id),
                Map.of("name", service.getName(), "enabled", service.getEnabled()));
        return service;
    }

    public AppointmentServiceEntity getService(Long tenantId, Long id) {
        return services.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "服务不存在"));
    }

    public List<AppointmentDtos.SlotView> slots(Long tenantId, Long serviceId, String date) {
        AppointmentServiceEntity service = getService(tenantId, serviceId);
        if (!validDate(date)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DATE_INVALID", "日期格式需为 YYYY-MM-DD");
        }
        return readSlots(service.getSlotsJson()).stream().map(slot -> {
            long used = appointments.countByServiceIdAndAppointmentDateAndSlotAndStatus(serviceId, date, slot, "BOOKED");
            return new AppointmentDtos.SlotView(slot, service.getCapacityPerSlot(), used,
                    Math.max(0, service.getCapacityPerSlot() - used));
        }).toList();
    }

    @Transactional
    public Appointment book(Long tenantId, Long serviceId, Long memberId, AppointmentDtos.BookRequest request) {
        AppointmentServiceEntity service = getService(tenantId, serviceId);
        if (!Boolean.TRUE.equals(service.getEnabled())) {
            throw new ApiException(HttpStatus.CONFLICT, "SERVICE_DISABLED", "服务不可预约");
        }
        members.findByIdAndTenantId(memberId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "会员不存在"));
        String today = LocalDate.now(ZONE).toString();
        if (!validDate(request.date()) || request.date().compareTo(today) < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DATE_INVALID", "不能预约过去的日期");
        }
        if (!readSlots(service.getSlotsJson()).contains(request.slot())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "SLOT_INVALID", "预约时段无效");
        }
        if (appointments.existsByServiceIdAndMemberIdAndAppointmentDateAndSlotAndStatus(
                serviceId, memberId, request.date(), request.slot(), "BOOKED")) {
            throw new ApiException(HttpStatus.CONFLICT, "APPOINTMENT_DUPLICATE", "您已预约该时段");
        }
        long used = appointments.countByServiceIdAndAppointmentDateAndSlotAndStatus(
                serviceId, request.date(), request.slot(), "BOOKED");
        if (used >= service.getCapacityPerSlot()) {
            throw new ApiException(HttpStatus.CONFLICT, "APPOINTMENT_FULL", "该时段已约满");
        }
        Appointment appointment = new Appointment();
        appointment.setTenantId(tenantId);
        appointment.setServiceId(serviceId);
        appointment.setServiceName(service.getName());
        appointment.setMemberId(memberId);
        appointment.setAppointmentDate(request.date());
        appointment.setSlot(request.slot());
        appointment.setNote(request.note() == null ? "" : request.note());
        appointment.setStatus("BOOKED");
        appointments.save(appointment);
        audit.record("appointment.book", "appointment", String.valueOf(appointment.getId()),
                Map.of("serviceId", serviceId, "date", request.date(), "slot", request.slot()));
        return appointment;
    }

    @Transactional
    public Appointment cancel(Long tenantId, Long id, Long memberId) {
        Appointment appointment = appointments.findByIdAndTenantIdForUpdate(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "预约不存在"));
        if (memberId != null && !memberId.equals(appointment.getMemberId())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "无权操作该预约");
        }
        if (!"BOOKED".equals(appointment.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "APPOINTMENT_STATE", "预约已不可取消");
        }
        appointment.setStatus("CANCELLED");
        appointment.setCancelledAt(Instant.now());
        appointments.save(appointment);
        audit.record("appointment.cancel", "appointment", String.valueOf(id), Map.of("memberId", appointment.getMemberId()));
        return appointment;
    }

    @Transactional
    public Appointment complete(Long tenantId, Long id) {
        Appointment appointment = appointments.findByIdAndTenantIdForUpdate(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "预约不存在"));
        if (!"BOOKED".equals(appointment.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "APPOINTMENT_STATE", "仅已预约记录可完成");
        }
        appointment.setStatus("COMPLETED");
        appointment.setCompletedAt(Instant.now());
        appointments.save(appointment);
        audit.record("appointment.complete", "appointment", String.valueOf(id), Map.of("serviceName", appointment.getServiceName()));
        return appointment;
    }

    public List<Appointment> list(Long tenantId, String status) {
        return status == null || status.isBlank()
                ? appointments.findByTenantIdOrderByAppointmentDateAscSlotAsc(tenantId)
                : appointments.findByTenantIdAndStatusOrderByAppointmentDateAscSlotAsc(tenantId, status.toUpperCase());
    }

    public List<Appointment> mine(Long tenantId, Long memberId) {
        return appointments.findByTenantIdAndMemberIdOrderByAppointmentDateDescSlotDesc(tenantId, memberId);
    }

    public AppointmentDtos.ServiceView serviceView(AppointmentServiceEntity service) {
        return new AppointmentDtos.ServiceView(service.getId(), service.getName(), service.getPriceCent(),
                service.getDurationMinutes(), service.getCapacityPerSlot(), readSlots(service.getSlotsJson()),
                service.getEnabled(), service.getCreatedAt());
    }

    public AppointmentDtos.AppointmentView appointmentView(Appointment appointment) {
        return new AppointmentDtos.AppointmentView(appointment.getId(), appointment.getServiceId(),
                appointment.getServiceName(), appointment.getMemberId(), appointment.getAppointmentDate(),
                appointment.getSlot(), appointment.getNote(), appointment.getStatus(), appointment.getCreatedAt(),
                appointment.getCancelledAt(), appointment.getCompletedAt());
    }

    private void apply(AppointmentServiceEntity service, AppointmentDtos.ServiceRequest request) {
        service.setName(request.name().trim());
        service.setPriceCent(request.priceCent());
        service.setDurationMinutes(request.durationMinutes() == null ? 60 : request.durationMinutes());
        service.setCapacityPerSlot(request.capacityPerSlot() == null ? 1 : request.capacityPerSlot());
        List<String> slots = request.slots() == null || request.slots().isEmpty()
                ? List.of("09:00", "10:00", "14:00", "15:00") : request.slots().stream().limit(30).toList();
        try { service.setSlotsJson(objectMapper.writeValueAsString(slots)); }
        catch (Exception ex) { throw new IllegalArgumentException("时段配置序列化失败", ex); }
        service.setEnabled(request.enabled() == null || request.enabled());
    }

    private List<String> readSlots(String value) {
        try { return objectMapper.readValue(value, new TypeReference<>() {}); }
        catch (Exception ex) { return List.of(); }
    }

    private boolean validDate(String value) {
        try { LocalDate.parse(value); return true; }
        catch (Exception ex) { return false; }
    }
}

