package com.linlituan.saas.form;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "saas_forms")
@Getter
@Setter
@NoArgsConstructor
public class FormEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private Long tenantId;
    @Column(nullable = false, length = 80)
    private String title;
    @Column(length = 300)
    private String description;
    @Column(nullable = false, columnDefinition = "TEXT")
    private String fieldsJson;
    @Column(nullable = false, length = 24)
    private String status;
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

