package com.linlituan.saas.appointment;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_appointment_services")
@Getter
@Setter
@NoArgsConstructor
public class AppointmentServiceEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private Long tenantId;
    @Column(nullable = false, length = 40)
    private String name;
    @Column(nullable = false)
    private Long priceCent = 0L;
    @Column(nullable = false)
    private Integer durationMinutes = 60;
    @Column(nullable = false)
    private Integer capacityPerSlot = 1;
    @Column(nullable = false, columnDefinition = "TEXT")
    private String slotsJson;
    @Column(nullable = false)
    private Boolean enabled = true;
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

