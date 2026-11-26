package com.linlituan.saas.product;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface InventoryAdjustmentRepository extends JpaRepository<InventoryAdjustment, Long> {
    List<InventoryAdjustment> findTop50ByTenantIdAndProductIdOrderByCreatedAtDesc(Long tenantId, Long productId);
    Optional<InventoryAdjustment> findByIdAndTenantId(Long id, Long tenantId);
}

