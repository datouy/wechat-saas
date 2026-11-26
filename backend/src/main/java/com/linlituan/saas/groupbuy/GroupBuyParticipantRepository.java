package com.linlituan.saas.groupbuy;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface GroupBuyParticipantRepository extends JpaRepository<GroupBuyParticipant, Long> {
    List<GroupBuyParticipant> findByGroupBuyIdOrderByJoinedAtAsc(Long groupBuyId);
    long countByGroupBuyId(Long groupBuyId);
    boolean existsByGroupBuyIdAndMemberId(Long groupBuyId, Long memberId);
}

