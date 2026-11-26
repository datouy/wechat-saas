package com.linlituan.saas.product;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface ProductRepository extends JpaRepository<Product, Long> {
    Page<Product> findByTenantIdOrderByCreatedAtDesc(Long tenantId, Pageable pageable);
    Page<Product> findByTenantIdAndNameContainingIgnoreCaseOrderByCreatedAtDesc(Long tenantId, String keyword, Pageable pageable);
    long countByTenantId(Long tenantId);
    Optional<Product> findByIdAndTenantId(Long id, Long tenantId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Product p where p.id = :id and p.tenantId = :tenantId")
    Optional<Product> findByIdAndTenantIdForUpdate(@Param("id") Long id, @Param("tenantId") Long tenantId);
}

