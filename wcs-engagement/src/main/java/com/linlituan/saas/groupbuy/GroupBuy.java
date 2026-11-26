package com.linlituan.saas.groupbuy;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_group_buys")
@Getter
@Setter
@NoArgsConstructor
public class GroupBuy {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private Long tenantId;
    @Column(nullable = false)
    private Long productId;
    @Column(nullable = false, length = 80)
    private String title;
    @Column(nullable = false)
    private Long groupPriceCent;
    @Column(nullable = false)
    private Integer minParticipants;
    @Column(nullable = false)
    private Integer maxParticipants;
    @Column(nullable = false, length = 24)
    private String status;
    @Column(nullable = false)
    private Instant startAt;
    @Column(nullable = false)
    private Instant endAt;
    private Instant successAt;
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

