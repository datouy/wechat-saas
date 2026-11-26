package com.linlituan.saas.coupon;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/coupons")
@PreAuthorize("hasAnyRole('OWNER','MANAGER')")
public class CouponController {
    private final CouponService service;

    public CouponController(CouponService service) {
        this.service = service;
    }

    @GetMapping("/templates")
    public ApiResponse<List<CouponDtos.TemplateView>> templates() {
        return ApiResponse.ok(service.templates(TenantContext.require().tenantId()).stream().map(this::toView).toList());
    }

    @PostMapping("/templates")
    public ApiResponse<CouponDtos.TemplateView> create(@Valid @RequestBody CouponDtos.TemplateRequest request) {
        return ApiResponse.ok(toView(service.createTemplate(TenantContext.require().tenantId(), request)));
    }

    @PutMapping("/templates/{id}")
    public ApiResponse<CouponDtos.TemplateView> update(@PathVariable Long id,
                                                       @Valid @RequestBody CouponDtos.TemplateRequest request) {
        return ApiResponse.ok(toView(service.updateTemplate(TenantContext.require().tenantId(), id, request)));
    }

    @GetMapping
    public ApiResponse<List<CouponDtos.CouponView>> issued() {
        return ApiResponse.ok(service.issued(TenantContext.require().tenantId()).stream().map(this::toCoupon).toList());
    }

    private CouponDtos.TemplateView toView(CouponTemplate item) {
        return new CouponDtos.TemplateView(item.getId(), item.getName(), item.getThresholdCent(), item.getAmountCent(),
                item.getValidDays(), item.getLimitPerMember(), item.getEnabled(), item.getCreatedAt());
    }

    private CouponDtos.CouponView toCoupon(Coupon item) {
        return new CouponDtos.CouponView(item.getId(), item.getTemplateId(), item.getMemberId(), item.getName(),
                item.getThresholdCent(), item.getAmountCent(), item.getStatus(), item.getExpireAt(),
                item.getReservedOrderId(), item.getUsedAt(), item.getCreatedAt());
    }
}

