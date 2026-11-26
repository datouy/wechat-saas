package com.linlituan.saas.groupbuy;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.time.Instant;

public final class GroupBuyDtos {
    private GroupBuyDtos() {
    }

    public record CreateRequest(
            @NotBlank(message = "团购标题不能为空") String title,
            @NotNull(message = "请选择商品") Long productId,
            @NotNull @Positive(message = "团购价必须大于 0") Long groupPriceCent,
            @Min(value = 2, message = "成团人数至少为 2") Integer minParticipants,
            @Min(value = 2, message = "人数上限至少为 2") Integer maxParticipants,
            Instant endAt
    ) {
    }

    public record UpdateRequest(String title, Instant endAt, Integer extendHours, Integer maxParticipants) {
    }

    public record View(Long id, Long productId, String productName, String title,
                       Long groupPriceCent, Integer minParticipants, Integer maxParticipants,
                       String status, Instant startAt, Instant endAt, Instant successAt,
                       long participantCount, long remaining, java.time.Instant createdAt) {
    }
}

