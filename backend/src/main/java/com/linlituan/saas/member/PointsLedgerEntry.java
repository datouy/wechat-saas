package com.linlituan.saas.member;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_points_ledger")
@Getter
@Setter
@NoArgsConstructor
public class PointsLedgerEntry {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false)
    private Long memberId;

    @Column(nullable = false)
    private Long changeAmount;

    @Column(nullable = false, length = 200)
    private String reason;

    @Column(length = 80)
    private String refId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

