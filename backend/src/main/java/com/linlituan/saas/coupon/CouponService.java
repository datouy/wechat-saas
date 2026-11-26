package com.linlituan.saas.coupon;

import com.linlituan.saas.audit.AuditService;
import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.member.Member;
import com.linlituan.saas.member.MemberRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

@Service
public class CouponService {
    private final CouponTemplateRepository templates;
    private final CouponRepository coupons;
    private final MemberRepository members;
    private final AuditService audit;

    public CouponService(CouponTemplateRepository templates, CouponRepository coupons,
                         MemberRepository members, AuditService audit) {
        this.templates = templates;
        this.coupons = coupons;
        this.members = members;
        this.audit = audit;
    }

    @Transactional
    public CouponTemplate createTemplate(Long tenantId, CouponDtos.TemplateRequest request) {
        CouponTemplate template = new CouponTemplate();
        template.setTenantId(tenantId);
        apply(template, request);
        templates.save(template);
        audit.record("coupon.template-create", "coupon-template", String.valueOf(template.getId()),
                Map.of("name", template.getName(), "amountCent", template.getAmountCent()));
        return template;
    }

    @Transactional
    public CouponTemplate updateTemplate(Long tenantId, Long id, CouponDtos.TemplateRequest request) {
        CouponTemplate template = templates.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "优惠券模板不存在"));
        apply(template, request);
        templates.save(template);
        audit.record("coupon.template-update", "coupon-template", String.valueOf(id),
                Map.of("name", template.getName(), "enabled", template.getEnabled()));
        return template;
    }

    public List<CouponTemplate> templates(Long tenantId) {
        return templates.findByTenantIdOrderByCreatedAtDesc(tenantId);
    }

    public List<Coupon> issued(Long tenantId) {
        return coupons.findByTenantIdOrderByCreatedAtDesc(tenantId);
    }

    @Transactional
    public Coupon claim(Long tenantId, Long templateId, Long memberId) {
        CouponTemplate template = templates.findByIdAndTenantId(templateId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "优惠券模板不存在"));
        if (!Boolean.TRUE.equals(template.getEnabled())) {
            throw new ApiException(HttpStatus.CONFLICT, "COUPON_DISABLED", "优惠券已停用");
        }
        Member member = members.findByIdAndTenantId(memberId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "会员不存在"));
        long claimed = coupons.countByTemplateIdAndMemberId(templateId, memberId);
        if (claimed >= template.getLimitPerMember()) {
            throw new ApiException(HttpStatus.CONFLICT, "COUPON_LIMIT", "已达领取上限");
        }
        Coupon coupon = new Coupon();
        coupon.setTenantId(tenantId);
        coupon.setTemplateId(template.getId());
        coupon.setMemberId(member.getId());
        coupon.setName(template.getName());
        coupon.setThresholdCent(template.getThresholdCent());
        coupon.setAmountCent(template.getAmountCent());
        coupon.setStatus("UNUSED");
        coupon.setExpireAt(Instant.now().plus(template.getValidDays(), ChronoUnit.DAYS));
        coupons.save(coupon);
        audit.record("coupon.claim", "coupon", String.valueOf(coupon.getId()),
                Map.of("templateId", templateId, "memberId", memberId));
        return coupon;
    }

    public List<Coupon> mine(Long tenantId, Long memberId) {
        List<Coupon> list = coupons.findByTenantIdAndMemberIdOrderByCreatedAtDesc(tenantId, memberId);
        Instant now = Instant.now();
        list.stream().filter(item -> "UNUSED".equals(item.getStatus()) && item.getExpireAt().isBefore(now))
                .forEach(item -> {
                    item.setStatus("EXPIRED");
                    coupons.save(item);
                });
        return list;
    }

    @Transactional
    public Coupon reserve(Long tenantId, Long couponId, Long memberId, Long orderId) {
        Coupon coupon = coupons.findByIdAndTenantIdForUpdate(couponId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "优惠券不存在"));
        if (!coupon.getMemberId().equals(memberId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "优惠券不属于当前会员");
        }
        if (!"UNUSED".equals(coupon.getStatus()) || coupon.getExpireAt().isBefore(Instant.now())) {
            throw new ApiException(HttpStatus.CONFLICT, "COUPON_UNAVAILABLE", "优惠券不可用");
        }
        coupon.setStatus("RESERVED");
        coupon.setReservedOrderId(orderId);
        coupons.save(coupon);
        audit.record("coupon.reserve", "coupon", String.valueOf(couponId), Map.of("orderId", orderId));
        return coupon;
    }

    @Transactional
    public void release(Long tenantId, Long couponId, Long orderId) {
        coupons.findByIdAndTenantIdForUpdate(couponId, tenantId).ifPresent(coupon -> {
            if ("RESERVED".equals(coupon.getStatus()) && orderId.equals(coupon.getReservedOrderId())) {
                coupon.setStatus("UNUSED");
                coupon.setReservedOrderId(null);
                coupons.save(coupon);
                audit.record("coupon.release", "coupon", String.valueOf(couponId), Map.of("orderId", orderId));
            }
        });
    }

    @Transactional
    public void use(Long tenantId, Long couponId) {
        coupons.findByIdAndTenantIdForUpdate(couponId, tenantId).ifPresent(coupon -> {
            if (java.util.Set.of("UNUSED", "RESERVED").contains(coupon.getStatus())) {
                coupon.setStatus("USED");
                coupon.setUsedAt(Instant.now());
                coupon.setReservedOrderId(null);
                coupons.save(coupon);
                audit.record("coupon.use", "coupon", String.valueOf(couponId), Map.of());
            }
        });
    }

    private void apply(CouponTemplate template, CouponDtos.TemplateRequest request) {
        template.setName(request.name().trim());
        template.setThresholdCent(request.thresholdCent());
        template.setAmountCent(request.amountCent());
        template.setValidDays(request.validDays() == null ? 30 : request.validDays());
        template.setLimitPerMember(request.limitPerMember() == null ? 1 : request.limitPerMember());
        template.setEnabled(request.enabled() == null || request.enabled());
    }
}

