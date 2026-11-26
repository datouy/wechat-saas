package com.linlituan.saas.coupon;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_coupon_templates")
@Getter
@Setter
@NoArgsConstructor
public class CouponTemplate {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private Long tenantId;
    @Column(nullable = false, length = 40)
    private String name;
    @Column(nullable = false)
    private Long thresholdCent = 0L;
    @Column(nullable = false)
    private Long amountCent;
    @Column(nullable = false)
    private Integer validDays = 30;
    @Column(nullable = false)
    private Integer limitPerMember = 1;
    @Column(nullable = false)
    private Boolean enabled = true;
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

