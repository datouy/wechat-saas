package com.linlituan.saas.appointment;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface AppointmentRepository extends JpaRepository<Appointment, Long> {
    long countByServiceIdAndAppointmentDateAndSlotAndStatus(Long serviceId, String date, String slot, String status);
    boolean existsByServiceIdAndMemberIdAndAppointmentDateAndSlotAndStatus(Long serviceId, Long memberId, String date, String slot, String status);
    List<Appointment> findByTenantIdOrderByAppointmentDateAscSlotAsc(Long tenantId);
    List<Appointment> findByTenantIdAndStatusOrderByAppointmentDateAscSlotAsc(Long tenantId, String status);
    List<Appointment> findByTenantIdAndMemberIdOrderByAppointmentDateDescSlotDesc(Long tenantId, Long memberId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Appointment a where a.id = :id and a.tenantId = :tenantId")
    Optional<Appointment> findByIdAndTenantIdForUpdate(@Param("id") Long id, @Param("tenantId") Long tenantId);
}

