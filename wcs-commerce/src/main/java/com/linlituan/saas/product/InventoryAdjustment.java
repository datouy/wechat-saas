package com.linlituan.saas.product;

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
@Table(name = "saas_inventory_adjustments")
@Getter
@Setter
@NoArgsConstructor
public class InventoryAdjustment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false)
    private Long productId;

    @Column(nullable = false, length = 80)
    private String productName;

    @Column(nullable = false)
    private Integer beforeStock;

    @Column(nullable = false)
    private Integer delta;

    @Column(nullable = false)
    private Integer afterStock;

    @Column(nullable = false, length = 200)
    private String reason;

    private Long actorId;

    @Column(length = 80)
    private String actorName;

    private Instant undoneAt;
    private Long reversedAdjustmentId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

