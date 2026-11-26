package com.linlituan.saas.form;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FormSubmissionRepository extends JpaRepository<FormSubmission, Long> {
    List<FormSubmission> findByFormIdOrderByCreatedAtDesc(Long formId);
    boolean existsByFormIdAndMemberId(Long formId, Long memberId);
    List<FormSubmission> findByTenantIdAndMemberIdOrderByCreatedAtDesc(Long tenantId, Long memberId);
}

