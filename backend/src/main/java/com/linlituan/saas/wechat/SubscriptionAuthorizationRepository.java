package com.linlituan.saas.wechat;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SubscriptionAuthorizationRepository extends JpaRepository<SubscriptionAuthorization, Long> {
    List<SubscriptionAuthorization> findByTenantIdAndMemberIdOrderByCreatedAtDesc(Long tenantId, Long memberId);
}

