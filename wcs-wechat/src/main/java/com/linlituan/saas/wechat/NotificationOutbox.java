package com.linlituan.saas.wechat;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_notification_outbox")
@Getter
@Setter
@NoArgsConstructor
public class NotificationOutbox {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private Long tenantId;
    private Long memberId;
    @Column(nullable = false, length = 40)
    private String event;
    @Column(length = 80)
    private String title;
    @Column(length = 128)
    private String templateId;
    @Column(length = 200)
    private String page;
    @Column(columnDefinition = "TEXT")
    private String payloadJson;
    @Column(nullable = false, length = 24)
    private String status;
    @Column(nullable = false)
    private Integer attempts = 0;
    private Instant nextAttemptAt;
    @Column(length = 500)
    private String error;
    private Instant sentAt;
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

