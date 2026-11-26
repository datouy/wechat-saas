package com.linlituan.saas.member;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

@RestController
@RequestMapping("/api/members")
public class MemberController {
    private final MemberRepository members;
    private final PointsService points;

    public MemberController(MemberRepository members, PointsService points) {
        this.members = members;
        this.points = points;
    }

    @GetMapping
    public ApiResponse<Page<MemberView>> list(@RequestParam(required = false) String keyword,
                                              @RequestParam(defaultValue = "1") int page,
                                              @RequestParam(defaultValue = "20") int size) {
        Long tenantId = TenantContext.require().tenantId();
        PageRequest pageable = PageRequest.of(Math.max(0, page - 1), Math.min(100, Math.max(1, size)),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<Member> result = keyword == null || keyword.isBlank()
                ? members.findByTenantIdOrderByCreatedAtDesc(tenantId, pageable)
                : members.findByTenantIdAndNicknameContainingIgnoreCaseOrderByCreatedAtDesc(tenantId, keyword.trim(), pageable);
        return ApiResponse.ok(result.map(this::toView));
    }

    @GetMapping("/{id}/points")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<PointsDtos.PointsView> points(@PathVariable Long id) {
        return ApiResponse.ok(points.view(TenantContext.require().tenantId(), id));
    }

    @PostMapping("/{id}/points")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<PointsDtos.PointsView> adjustPoints(@PathVariable Long id,
                                                           @Valid @RequestBody PointsDtos.AdjustRequest request) {
        Long tenantId = TenantContext.require().tenantId();
        points.adjust(tenantId, id, request);
        return ApiResponse.ok(points.view(tenantId, id));
    }

    private MemberView toView(Member member) {
        return new MemberView(member.getId(), member.getNickname(), member.getPhone(),
                member.getPoints(), member.getTotalSpentCent(), member.getOrderCount(), member.getCreatedAt());
    }

    public record MemberView(Long id, String nickname, String phone, Long points,
                             Long totalSpentCent, Integer orderCount, Instant createdAt) {
    }
}

