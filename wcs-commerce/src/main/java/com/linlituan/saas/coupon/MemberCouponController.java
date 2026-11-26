package com.linlituan.saas.coupon;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/wx/coupons")
public class MemberCouponController {
    private final CouponService service;

    public MemberCouponController(CouponService service) {
        this.service = service;
    }

    @GetMapping("/templates")
    public ApiResponse<List<CouponDtos.TemplateView>> templates() {
        Long tenantId = TenantContext.require().tenantId();
        return ApiResponse.ok(service.templates(tenantId).stream()
                .filter(CouponTemplate::getEnabled)
                .map(item -> new CouponDtos.TemplateView(item.getId(), item.getName(), item.getThresholdCent(),
                        item.getAmountCent(), item.getValidDays(), item.getLimitPerMember(), item.getEnabled(), item.getCreatedAt()))
                .toList());
    }

    @PostMapping("/claim/{templateId}")
    public ApiResponse<CouponDtos.CouponView> claim(@PathVariable Long templateId) {
        TenantContext.Context context = TenantContext.require();
        Coupon item = service.claim(context.tenantId(), templateId, context.userId());
        return ApiResponse.ok(new CouponDtos.CouponView(item.getId(), item.getTemplateId(), item.getMemberId(),
                item.getName(), item.getThresholdCent(), item.getAmountCent(), item.getStatus(), item.getExpireAt(),
                item.getReservedOrderId(), item.getUsedAt(), item.getCreatedAt()));
    }

    @GetMapping
    public ApiResponse<List<CouponDtos.CouponView>> mine() {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(service.mine(context.tenantId(), context.userId()).stream()
                .map(item -> new CouponDtos.CouponView(item.getId(), item.getTemplateId(), item.getMemberId(),
                        item.getName(), item.getThresholdCent(), item.getAmountCent(), item.getStatus(), item.getExpireAt(),
                        item.getReservedOrderId(), item.getUsedAt(), item.getCreatedAt()))
                .toList());
    }
}

