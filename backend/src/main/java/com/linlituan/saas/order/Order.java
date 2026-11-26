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
@Table(name = "saas_orders")
@Getter
@Setter
@NoArgsConstructor
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false)
    private Long memberId;

    @Column(nullable = false, unique = true, length = 40)
    private String orderNo;

    @Column(nullable = false, length = 24)
    private String status;

    @Column(nullable = false, length = 24)
    private String paymentMode;

    @Column(nullable = false)
    private Long goodsAmountCent;

    @Column(nullable = false)
    private Long payAmountCent;

    @Column(length = 200)
    private String remark;

    @Column(name = "delivered_at")
    private Instant deliveredAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "logistics_company", length = 50)
    private String logisticsCompany;

    @Column(name = "logistics_no", length = 64)
    private String logisticsNo;

    @Column(nullable = false)
    private Long refundedAmountCent = 0L;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    private Instant paidAt;
    private Instant cancelledAt;
}

