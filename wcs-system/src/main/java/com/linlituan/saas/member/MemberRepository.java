package com.linlituan.saas.member;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface MemberRepository extends JpaRepository<Member, Long> {
    Page<Member> findByTenantIdOrderByCreatedAtDesc(Long tenantId, Pageable pageable);
    Page<Member> findByTenantIdAndNicknameContainingIgnoreCaseOrderByCreatedAtDesc(Long tenantId, String keyword, Pageable pageable);
    Optional<Member> findByIdAndTenantId(Long id, Long tenantId);
    Optional<Member> findByTenantIdAndOpenid(Long tenantId, String openid);
    long countByTenantId(Long tenantId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from Member m where m.id = :id and m.tenantId = :tenantId")
    Optional<Member> findByIdAndTenantIdForUpdate(@Param("id") Long id, @Param("tenantId") Long tenantId);
}

