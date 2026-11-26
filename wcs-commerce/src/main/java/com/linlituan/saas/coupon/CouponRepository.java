package com.linlituan.saas.coupon;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface CouponRepository extends JpaRepository<Coupon, Long> {
    long countByTemplateIdAndMemberId(Long templateId, Long memberId);
    List<Coupon> findByTenantIdAndMemberIdOrderByCreatedAtDesc(Long tenantId, Long memberId);
    List<Coupon> findByTenantIdOrderByCreatedAtDesc(Long tenantId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Coupon c where c.id = :id and c.tenantId = :tenantId")
    Optional<Coupon> findByIdAndTenantIdForUpdate(@Param("id") Long id, @Param("tenantId") Long tenantId);
}

