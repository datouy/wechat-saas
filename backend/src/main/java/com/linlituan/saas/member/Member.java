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
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_members")
@Getter
@Setter
@NoArgsConstructor
public class Member {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 96)
    private String openid;

    @Column(nullable = false, length = 80)
    private String nickname;

    @Column(length = 32)
    private String phone;

    @Column(nullable = false)
    private Long points = 0L;

    @Column(nullable = false)
    private Long totalSpentCent = 0L;

    @Column(nullable = false)
    private Integer orderCount = 0;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}

