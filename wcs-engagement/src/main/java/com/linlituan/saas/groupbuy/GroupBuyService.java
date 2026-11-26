package com.linlituan.saas.groupbuy;

import com.linlituan.saas.audit.AuditService;
import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.product.Product;
import com.linlituan.saas.product.ProductRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

@Service
public class GroupBuyService {
    private final GroupBuyRepository groups;
    private final GroupBuyParticipantRepository participants;
    private final ProductRepository products;
    private final AuditService audit;

    public GroupBuyService(GroupBuyRepository groups, GroupBuyParticipantRepository participants,
                           ProductRepository products, AuditService audit) {
        this.groups = groups;
        this.participants = participants;
        this.products = products;
        this.audit = audit;
    }

    @Transactional
    public GroupBuy create(Long tenantId, GroupBuyDtos.CreateRequest request) {
        Product product = products.findByIdAndTenantId(request.productId(), tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "商品不存在"));
        if (request.groupPriceCent() > product.getPriceCent()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "GROUP_PRICE", "团购价不能高于商品原价");
        }
        int min = Math.max(2, request.minParticipants() == null ? 2 : request.minParticipants());
        int max = Math.max(min, request.maxParticipants() == null ? 100 : request.maxParticipants());
        Instant endAt = request.endAt() == null ? Instant.now().plus(24, ChronoUnit.HOURS) : request.endAt();
        if (!endAt.isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "GROUP_END", "团购截止时间必须晚于当前时间");
        }
        GroupBuy group = new GroupBuy();
        group.setTenantId(tenantId);
        group.setProductId(product.getId());
        group.setTitle(request.title().trim());
        group.setGroupPriceCent(request.groupPriceCent());
        group.setMinParticipants(min);
        group.setMaxParticipants(max);
        group.setStatus("ACTIVE");
        group.setStartAt(Instant.now());
        group.setEndAt(endAt);
        groups.save(group);
        audit.record("groupbuy.create", "group-buy", String.valueOf(group.getId()),
                Map.of("title", group.getTitle(), "productId", product.getId(), "groupPriceCent", group.getGroupPriceCent()));
        return group;
    }

    public List<GroupBuyDtos.View> list(Long tenantId, String status) {
        List<GroupBuy> list = status == null || status.isBlank()
                ? groups.findByTenantIdOrderByCreatedAtDesc(tenantId)
                : groups.findByTenantIdAndStatusOrderByCreatedAtDesc(tenantId, status.toUpperCase());
        return list.stream().map(this::toView).toList();
    }

    public GroupBuyDtos.View get(Long tenantId, Long id) {
        GroupBuy group = groups.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "团购活动不存在"));
        return toView(group);
    }

    @Transactional
    public GroupBuyDtos.View update(Long tenantId, Long id, GroupBuyDtos.UpdateRequest request) {
        GroupBuy group = groups.findByIdAndTenantIdForUpdate(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "团购活动不存在"));
        if (java.util.Set.of("CANCELLED", "CLOSED").contains(group.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "GROUP_CLOSED", "已结束的团购不能修改");
        }
        if (request.title() != null) group.setTitle(request.title().trim());
        if (request.endAt() != null) {
            if (!request.endAt().isAfter(Instant.now())) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "GROUP_END", "新的截止时间必须晚于当前时间");
            }
            group.setEndAt(request.endAt());
        }
        if (request.extendHours() != null) {
            Instant base = group.getEndAt().isAfter(Instant.now()) ? group.getEndAt() : Instant.now();
            group.setEndAt(base.plus(Math.max(1, request.extendHours()), ChronoUnit.HOURS));
        }
        if (request.maxParticipants() != null) {
            long joined = participants.countByGroupBuyId(group.getId());
            int max = Math.max(group.getMinParticipants(), request.maxParticipants());
            if (max < joined) throw new ApiException(HttpStatus.CONFLICT, "GROUP_MAX", "人数上限不能小于当前参团人数");
            group.setMaxParticipants(max);
        }
        groups.save(group);
        audit.record("groupbuy.update", "group-buy", String.valueOf(id),
                Map.of("title", group.getTitle(), "endAt", group.getEndAt().toString(), "maxParticipants", group.getMaxParticipants()));
        return toView(group);
    }

    @Transactional
    public GroupBuyDtos.View join(Long tenantId, Long id, Long memberId) {
        GroupBuy group = groups.findByIdAndTenantIdForUpdate(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "团购活动不存在"));
        if (java.util.Set.of("CANCELLED", "CLOSED").contains(group.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "GROUP_CLOSED", "活动已结束");
        }
        if (!group.getEndAt().isAfter(Instant.now())) {
            group.setStatus("CLOSED");
            groups.save(group);
            throw new ApiException(HttpStatus.CONFLICT, "GROUP_CLOSED", "活动已截止");
        }
        if (participants.existsByGroupBuyIdAndMemberId(id, memberId)) {
            return toView(group);
        }
        long joined = participants.countByGroupBuyId(id);
        if (joined >= group.getMaxParticipants()) {
            throw new ApiException(HttpStatus.CONFLICT, "GROUP_FULL", "参团人数已满");
        }
        GroupBuyParticipant participant = new GroupBuyParticipant();
        participant.setGroupBuyId(id);
        participant.setMemberId(memberId);
        participant.setRole(joined == 0 ? "LEADER" : "MEMBER");
        participants.save(participant);
        if (joined + 1 >= group.getMinParticipants() && !"SUCCESS".equals(group.getStatus())) {
            group.setStatus("SUCCESS");
            group.setSuccessAt(Instant.now());
            groups.save(group);
        }
        audit.record("groupbuy.join", "group-buy", String.valueOf(id),
                Map.of("memberId", memberId, "role", participant.getRole()));
        return toView(group);
    }

    @Transactional
    public GroupBuyDtos.View cancel(Long tenantId, Long id) {
        GroupBuy group = groups.findByIdAndTenantIdForUpdate(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "团购活动不存在"));
        group.setStatus("CANCELLED");
        groups.save(group);
        audit.record("groupbuy.cancel", "group-buy", String.valueOf(id), Map.of("title", group.getTitle()));
        return toView(group);
    }

    private GroupBuyDtos.View toView(GroupBuy group) {
        Product product = products.findByIdAndTenantId(group.getProductId(), group.getTenantId()).orElse(null);
        long joined = participants.countByGroupBuyId(group.getId());
        return new GroupBuyDtos.View(group.getId(), group.getProductId(), product == null ? "" : product.getName(),
                group.getTitle(), group.getGroupPriceCent(), group.getMinParticipants(), group.getMaxParticipants(),
                group.getStatus(), group.getStartAt(), group.getEndAt(), group.getSuccessAt(),
                joined, Math.max(0, group.getMinParticipants() - joined), group.getCreatedAt());
    }
}

