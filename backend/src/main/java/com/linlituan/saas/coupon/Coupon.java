package com.linlituan.saas.coupon;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_coupons")
@Getter
@Setter
@NoArgsConstructor
public class Coupon {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private Long tenantId;
    @Column(nullable = false)
    private Long templateId;
    @Column(nullable = false)
    private Long memberId;
    @Column(nullable = false, length = 40)
    private String name;
    @Column(nullable = false)
    private Long thresholdCent;
    @Column(nullable = false)
    private Long amountCent;
    @Column(nullable = false, length = 24)
    private String status;
    @Column(nullable = false)
    private Instant expireAt;
    private Long reservedOrderId;
    private Instant usedAt;
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

