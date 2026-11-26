package com.linlituan.saas.member;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.List;

public final class PointsDtos {
    private PointsDtos() {
    }

    public record AdjustRequest(
            @NotNull(message = "请输入积分变更数量") Long amount,
            @NotBlank(message = "请填写调整原因") String reason
    ) {
    }

    public record LedgerView(Long id, Long changeAmount, String reason, String refId, Instant createdAt) {
    }

    public record PointsView(Long memberId, String nickname, Long balance, List<LedgerView> ledger) {
    }
}

