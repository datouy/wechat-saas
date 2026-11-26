package com.linlituan.saas.product;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ProductCategoryRepository extends JpaRepository<ProductCategory, Long> {
    Optional<ProductCategory> findByIdAndTenantId(Long id, Long tenantId);
}

