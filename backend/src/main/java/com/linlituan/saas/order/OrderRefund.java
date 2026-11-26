package com.linlituan.saas.order;

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
@Table(name = "saas_order_refunds")
@Getter
@Setter
@NoArgsConstructor
public class OrderRefund {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false)
    private Long orderId;

    @Column(nullable = false, length = 40)
    private String orderNo;

    @Column(nullable = false, length = 48)
    private String refundNo;

    @Column(nullable = false)
    private Long amountCent;

    @Column(nullable = false, length = 200)
    private String reason;

    @Column(nullable = false, length = 24)
    private String status;

    @Column(length = 96)
    private String idempotencyKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

