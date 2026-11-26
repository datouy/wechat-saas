package com.linlituan.saas.wechat;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlituan.saas.audit.AuditService;
import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.member.Member;
import com.linlituan.saas.member.MemberRepository;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class WechatSubscriptionService {
    private final Environment environment;
    private final ObjectMapper objectMapper;
    private final WechatGateway gateway;
    private final MemberRepository members;
    private final SubscriptionAuthorizationRepository authorizations;
    private final NotificationOutboxRepository outbox;
    private final AuditService audit;

    public WechatSubscriptionService(Environment environment, ObjectMapper objectMapper, WechatGateway gateway,
                                     MemberRepository members, SubscriptionAuthorizationRepository authorizations,
                                     NotificationOutboxRepository outbox, AuditService audit) {
        this.environment = environment;
        this.objectMapper = objectMapper;
        this.gateway = gateway;
        this.members = members;
        this.authorizations = authorizations;
        this.outbox = outbox;
        this.audit = audit;
    }

    public WechatDtos.SubscriptionView view(Long tenantId, Long memberId) {
        Map<String, Map<String, Object>> templates = templates();
        List<WechatDtos.SubscriptionEvent> events = new ArrayList<>();
        templates.forEach((event, config) -> {
            String templateId = String.valueOf(config.getOrDefault("templateId", ""));
            String page = String.valueOf(config.getOrDefault("page", ""));
            events.add(new WechatDtos.SubscriptionEvent(event, templateId, page, !templateId.isBlank()));
        });
        List<SubscriptionAuthorization> list = authorizations.findByTenantIdAndMemberIdOrderByCreatedAtDesc(tenantId, memberId);
        SubscriptionAuthorization latest = list.isEmpty() ? null : list.get(0);
        Map<String, String> decisions = latest == null ? Map.of() : read(latest.getDecisionsJson());
        return new WechatDtos.SubscriptionView(events, decisions, latest == null ? null : latest.getCreatedAt());
    }

    @Transactional
    public SubscriptionAuthorization authorize(Long tenantId, Long memberId, Map<String, String> decisions) {
        SubscriptionAuthorization record = new SubscriptionAuthorization();
        record.setTenantId(tenantId);
        record.setMemberId(memberId);
        record.setDecisionsJson(write(decisions == null ? Map.of() : decisions));
        authorizations.save(record);
        audit.record("wechat.subscription-authorize", "member", String.valueOf(memberId), decisions);
        return record;
    }

    @Transactional
    public NotificationOutbox test(Long tenantId, WechatDtos.SubscriptionTestRequest request) {
        if (request == null || request.memberId() == null || request.templateId() == null || request.templateId().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION", "请选择会员和模板 ID");
        }
        Member member = members.findByIdAndTenantId(request.memberId(), tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "会员不存在"));
        NotificationOutbox item = new NotificationOutbox();
        item.setTenantId(tenantId);
        item.setMemberId(member.getId());
        item.setEvent("test");
        item.setTitle("订阅消息测试");
        item.setTemplateId(request.templateId());
        item.setPage(request.page() == null ? "" : request.page());
        item.setPayloadJson(write(request.data() == null ? Map.of() : request.data()));
        item.setStatus("QUEUED");
        outbox.save(item);
        try {
            gateway.sendSubscribeMessage(member.getOpenid(), item.getTemplateId(), item.getPage(),
                    request.data() == null ? Map.of() : request.data());
            item.setStatus(gateway.isMock() ? "MOCKED" : "SENT");
            item.setSentAt(Instant.now());
            item.setAttempts(1);
        } catch (Exception ex) {
            item.setStatus("FAILED");
            item.setAttempts(1);
            item.setError(ex.getMessage() == null ? "发送失败" : ex.getMessage().substring(0, Math.min(500, ex.getMessage().length())));
        }
        outbox.save(item);
        audit.record("wechat.subscription-test", "notification", String.valueOf(item.getId()),
                Map.of("memberId", member.getId(), "templateId", item.getTemplateId(), "status", item.getStatus()));
        return item;
    }

    public List<NotificationOutbox> outbox(Long tenantId) {
        return outbox.findTop50ByTenantIdOrderByCreatedAtDesc(tenantId);
    }

    public Map<String, Map<String, Object>> templates() {
        String raw = environment.getProperty("app.wechat.subscribe-templates", "{}");
        try { return objectMapper.readValue(raw, new TypeReference<>() {}); }
        catch (Exception ex) { return Map.of(); }
    }

    private String write(Object value) {
        try { return objectMapper.writeValueAsString(value); }
        catch (Exception ex) { throw new IllegalArgumentException("JSON 序列化失败", ex); }
    }

    private Map<String, String> read(String value) {
        try { return objectMapper.readValue(value, new TypeReference<>() {}); }
        catch (Exception ex) { return Map.of(); }
    }
}

