package com.linlituan.saas.groupbuy;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_group_buy_participants")
@Getter
@Setter
@NoArgsConstructor
public class GroupBuyParticipant {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private Long groupBuyId;
    @Column(nullable = false)
    private Long memberId;
    @Column(nullable = false, length = 24)
    private String role;
    @CreationTimestamp
    @Column(name = "joined_at", nullable = false, updatable = false)
    private Instant joinedAt;
}

