package com.linlituan.saas.order;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface OrderRefundRepository extends JpaRepository<OrderRefund, Long> {
    List<OrderRefund> findByTenantIdAndOrderIdOrderByCreatedAtDesc(Long tenantId, Long orderId);
    Optional<OrderRefund> findByTenantIdAndIdempotencyKey(Long tenantId, String idempotencyKey);
}

