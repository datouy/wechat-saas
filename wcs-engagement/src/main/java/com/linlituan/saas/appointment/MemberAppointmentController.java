package com.linlituan.saas.appointment;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/wx")
public class MemberAppointmentController {
    private final AppointmentService service;

    public MemberAppointmentController(AppointmentService service) {
        this.service = service;
    }

    @GetMapping("/appointment-services")
    public ApiResponse<List<AppointmentDtos.ServiceView>> services() {
        return ApiResponse.ok(service.services(TenantContext.require().tenantId()).stream()
                .filter(AppointmentServiceEntity::getEnabled).map(service::serviceView).toList());
    }

    @GetMapping("/appointment-slots")
    public ApiResponse<List<AppointmentDtos.SlotView>> slots(@RequestParam Long serviceId, @RequestParam String date) {
        return ApiResponse.ok(service.slots(TenantContext.require().tenantId(), serviceId, date));
    }

    @PostMapping("/appointments")
    public ApiResponse<AppointmentDtos.AppointmentView> book(@RequestBody AppointmentDtos.BookRequest request) {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(service.appointmentView(service.book(context.tenantId(), request.serviceId(), context.userId(), request)));
    }

    @PostMapping("/appointments/{id}/cancel")
    public ApiResponse<AppointmentDtos.AppointmentView> cancel(@PathVariable Long id) {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(service.appointmentView(service.cancel(context.tenantId(), id, context.userId())));
    }

    @GetMapping("/appointments")
    public ApiResponse<List<AppointmentDtos.AppointmentView>> mine() {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(service.mine(context.tenantId(), context.userId()).stream().map(service::appointmentView).toList());
    }
}

