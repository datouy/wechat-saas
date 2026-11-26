package com.linlituan.saas.groupbuy;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface GroupBuyRepository extends JpaRepository<GroupBuy, Long> {
    List<GroupBuy> findByTenantIdOrderByCreatedAtDesc(Long tenantId);
    java.util.Optional<GroupBuy> findByIdAndTenantId(Long id, Long tenantId);
    List<GroupBuy> findByTenantIdAndStatusOrderByCreatedAtDesc(Long tenantId, String status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from GroupBuy g where g.id = :id and g.tenantId = :tenantId")
    Optional<GroupBuy> findByIdAndTenantIdForUpdate(@Param("id") Long id, @Param("tenantId") Long tenantId);
}

