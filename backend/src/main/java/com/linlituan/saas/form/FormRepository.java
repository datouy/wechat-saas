package com.linlituan.saas.form;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface FormRepository extends JpaRepository<FormEntity, Long> {
    List<FormEntity> findByTenantIdOrderByCreatedAtDesc(Long tenantId);
    Optional<FormEntity> findByIdAndTenantId(Long id, Long tenantId);
}

