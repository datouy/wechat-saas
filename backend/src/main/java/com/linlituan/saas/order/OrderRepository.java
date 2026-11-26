package com.linlituan.saas.order;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;

public interface OrderRepository extends JpaRepository<Order, Long> {
    Page<Order> findByTenantIdOrderByCreatedAtDesc(Long tenantId, Pageable pageable);
    Page<Order> findByTenantIdAndStatusOrderByCreatedAtDesc(Long tenantId, String status, Pageable pageable);
    long countByTenantIdAndCreatedAtAfter(Long tenantId, Instant after);
    long countByTenantIdAndStatus(Long tenantId, String status);
    Optional<Order> findByIdAndTenantId(Long id, Long tenantId);
    java.util.List<Order> findByTenantIdAndMemberIdOrderByCreatedAtDesc(Long tenantId, Long memberId);
    Optional<Order> findByOrderNo(String orderNo);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from Order o where o.id = :id and o.tenantId = :tenantId")
    Optional<Order> findByIdAndTenantIdForUpdate(@Param("id") Long id, @Param("tenantId") Long tenantId);

    @Query("select coalesce(sum(o.payAmountCent), 0) from Order o where o.tenantId = :tenantId and o.createdAt >= :after and o.status <> 'CANCELLED'")
    long sumPaidSince(@Param("tenantId") Long tenantId, @Param("after") Instant after);
}

