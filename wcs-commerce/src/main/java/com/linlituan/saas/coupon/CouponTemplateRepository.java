package com.linlituan.saas.coupon;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CouponTemplateRepository extends JpaRepository<CouponTemplate, Long> {
    List<CouponTemplate> findByTenantIdOrderByCreatedAtDesc(Long tenantId);
    Optional<CouponTemplate> findByIdAndTenantId(Long id, Long tenantId);
}

