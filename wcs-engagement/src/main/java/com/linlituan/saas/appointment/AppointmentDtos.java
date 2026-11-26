package com.linlituan.saas.appointment;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.Instant;
import java.util.List;

public final class AppointmentDtos {
    private AppointmentDtos() {
    }

    public record ServiceRequest(
            @NotBlank(message = "服务名称不能为空") String name,
            @NotNull @PositiveOrZero(message = "服务价格不能为负数") Long priceCent,
            @Min(value = 1, message = "时长至少为 1 分钟") Integer durationMinutes,
            @Min(value = 1, message = "每个时段容量至少为 1") Integer capacityPerSlot,
            List<String> slots,
            Boolean enabled
    ) {
    }

    public record BookRequest(
            @NotNull(message = "请选择服务") Long serviceId,
            @NotBlank(message = "请选择预约日期") String date,
            @NotBlank(message = "请选择预约时段") String slot,
            String note
    ) {
    }

    public record SlotView(String slot, int capacity, long used, long available) {
    }

    public record ServiceView(Long id, String name, Long priceCent, Integer durationMinutes,
                              Integer capacityPerSlot, List<String> slots, Boolean enabled, Instant createdAt) {
    }

    public record AppointmentView(Long id, Long serviceId, String serviceName, Long memberId,
                                  String appointmentDate, String slot, String note, String status,
                                  Instant createdAt, Instant cancelledAt, Instant completedAt) {
    }
}

