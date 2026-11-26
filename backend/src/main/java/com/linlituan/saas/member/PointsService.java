package com.linlituan.saas.member;

import com.linlituan.saas.audit.AuditService;
import com.linlituan.saas.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

@Service
public class PointsService {
    private final MemberRepository members;
    private final PointsLedgerRepository ledger;
    private final AuditService audit;

    public PointsService(MemberRepository members, PointsLedgerRepository ledger, AuditService audit) {
        this.members = members;
        this.ledger = ledger;
        this.audit = audit;
    }

    @Transactional
    public Member adjust(Long tenantId, Long memberId, PointsDtos.AdjustRequest request) {
        if (request.amount() == 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "POINTS_INVALID", "积分变更不能为 0");
        }
        Member member = members.findByIdAndTenantIdForUpdate(memberId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "会员不存在"));
        long next = member.getPoints() + request.amount();
        if (next < 0) throw new ApiException(HttpStatus.CONFLICT, "POINTS_INSUFFICIENT", "积分余额不足");
        member.setPoints(next);
        members.save(member);

        PointsLedgerEntry entry = new PointsLedgerEntry();
        entry.setTenantId(tenantId);
        entry.setMemberId(memberId);
        entry.setChangeAmount(request.amount());
        entry.setReason(request.reason().trim());
        entry.setRefId("admin-adjustment");
        ledger.save(entry);
        audit.record("member.points-adjust", "member", String.valueOf(memberId),
                Map.of("change", request.amount(), "balance", next, "reason", entry.getReason()));
        return member;
    }

    public PointsDtos.PointsView view(Long tenantId, Long memberId) {
        Member member = members.findByIdAndTenantId(memberId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "会员不存在"));
        List<PointsDtos.LedgerView> rows = ledger.findTop50ByTenantIdAndMemberIdOrderByCreatedAtDesc(tenantId, memberId)
                .stream()
                .map(item -> new PointsDtos.LedgerView(item.getId(), item.getChangeAmount(),
                        item.getReason(), item.getRefId(), item.getCreatedAt()))
                .toList();
        return new PointsDtos.PointsView(member.getId(), member.getNickname(), member.getPoints(), rows);
    }
}

