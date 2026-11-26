package com.linlituan.saas.wechat;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface NotificationOutboxRepository extends JpaRepository<NotificationOutbox, Long> {
    List<NotificationOutbox> findTop50ByTenantIdOrderByCreatedAtDesc(Long tenantId);
}

