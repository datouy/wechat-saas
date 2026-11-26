package com.linlituan.saas.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserAccountRepository extends JpaRepository<UserAccount, Long> {
    Optional<UserAccount> findByTenantIdAndUsername(Long tenantId, String username);
}

