package com.linlituan.saas.appointment;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AppointmentServiceRepository extends JpaRepository<AppointmentServiceEntity, Long> {
    List<AppointmentServiceEntity> findByTenantIdOrderByCreatedAtDesc(Long tenantId);
    Optional<AppointmentServiceEntity> findByIdAndTenantId(Long id, Long tenantId);
}

