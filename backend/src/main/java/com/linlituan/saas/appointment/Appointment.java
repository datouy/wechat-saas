package com.linlituan.saas.appointment;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_appointments")
@Getter
@Setter
@NoArgsConstructor
public class Appointment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private Long tenantId;
    @Column(nullable = false)
    private Long serviceId;
    @Column(nullable = false, length = 40)
    private String serviceName;
    @Column(nullable = false)
    private Long memberId;
    @Column(nullable = false, length = 10)
    private String appointmentDate;
    @Column(nullable = false, length = 10)
    private String slot;
    @Column(length = 100)
    private String note;
    @Column(nullable = false, length = 24)
    private String status;
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    private Instant cancelledAt;
    private Instant completedAt;
}

