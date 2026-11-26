package com.linlituan.saas.wechat;

import com.linlituan.saas.member.Member;
import com.linlituan.saas.member.MemberRepository;
import com.linlituan.saas.security.JwtService;
import com.linlituan.saas.tenant.Tenant;
import com.linlituan.saas.tenant.TenantRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WechatAuthService {
    private final WechatGateway gateway;
    private final MemberRepository members;
    private final TenantRepository tenants;
    private final JwtService jwtService;

    public WechatAuthService(WechatGateway gateway, MemberRepository members,
                             TenantRepository tenants, JwtService jwtService) {
        this.gateway = gateway;
        this.members = members;
        this.tenants = tenants;
        this.jwtService = jwtService;
    }

    @Transactional
    public WechatDtos.LoginResponse login(String tenantCode, String code) {
        Tenant tenant = tenants.findByCode(tenantCode)
                .orElseThrow(() -> new com.linlituan.saas.common.ApiException(
                        org.springframework.http.HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND", "租户不存在"));
        WechatGateway.CodeSession session = gateway.code2Session(code);
        Member member = members.findByTenantIdAndOpenid(tenant.getId(), session.openid()).orElseGet(() -> {
            Member created = new Member();
            created.setTenantId(tenant.getId());
            created.setOpenid(session.openid());
            created.setNickname("邻居" + session.openid().substring(Math.max(0, session.openid().length() - 4)));
            created.setPhone("");
            created.setPoints(0L);
            created.setTotalSpentCent(0L);
            created.setOrderCount(0);
            return members.save(created);
        });
        String token = jwtService.issueMember(member.getId(), tenant.getId(), member.getOpenid(), member.getNickname());
        return new WechatDtos.LoginResponse(token,
                new WechatDtos.MemberView(member.getId(), member.getNickname(), mask(member.getOpenid())),
                new WechatDtos.TenantView(tenant.getId(), tenant.getCode(), tenant.getName()), gateway.isMock());
    }

    private String mask(String openid) {
        if (openid == null || openid.length() <= 8) return openid;
        return openid.substring(0, 4) + "****" + openid.substring(openid.length() - 4);
    }
}

