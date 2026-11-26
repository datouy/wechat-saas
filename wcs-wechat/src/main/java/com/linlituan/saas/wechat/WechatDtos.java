package com.linlituan.saas.wechat;

import jakarta.validation.constraints.NotBlank;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class WechatDtos {
    private WechatDtos() {
    }

    public record LoginRequest(@NotBlank(message = "缺少微信登录 code") String code) {
    }

    public record MemberView(Long id, String nickname, String openid) {
    }

    public record TenantView(Long id, String code, String name) {
    }

    public record LoginResponse(String token, MemberView member, TenantView tenant, boolean mock) {
    }

    public record SubscriptionEvent(String event, String templateId, String page, boolean configured) {
    }

    public record SubscriptionView(List<SubscriptionEvent> events, Map<String, String> latestDecisions,
                                   Instant latestAt) {
    }

    public record AuthorizeRequest(Map<String, String> decisions) {
    }

    public record SubscriptionTestRequest(Long memberId, String templateId, String page, Map<String, Object> data) {
    }
}

