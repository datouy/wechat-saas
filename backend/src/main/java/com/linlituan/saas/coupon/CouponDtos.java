package com.linlituan.saas.coupon;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.Instant;

public final class CouponDtos {
    private CouponDtos() {
    }

    public record TemplateRequest(
            @NotBlank(message = "优惠券名称不能为空") String name,
            @NotNull @PositiveOrZero(message = "使用门槛不能为负数") Long thresholdCent,
            @NotNull @Positive(message = "优惠金额必须大于 0") Long amountCent,
            @Min(value = 1, message = "有效天数至少为 1") Integer validDays,
            @Min(value = 1, message = "每人限领至少为 1") Integer limitPerMember,
            Boolean enabled
    ) {
    }

    public record TemplateView(Long id, String name, Long thresholdCent, Long amountCent,
                               Integer validDays, Integer limitPerMember, Boolean enabled, Instant createdAt) {
    }

    public record CouponView(Long id, Long templateId, Long memberId, String name,
                             Long thresholdCent, Long amountCent, String status,
                             Instant expireAt, Long reservedOrderId, Instant usedAt, Instant createdAt) {
    }
}

