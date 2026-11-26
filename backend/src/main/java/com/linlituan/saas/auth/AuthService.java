package com.linlituan.saas.auth;

import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.security.JwtService;
import com.linlituan.saas.tenant.Tenant;
import com.linlituan.saas.tenant.TenantRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
    private final TenantRepository tenants;
    private final UserAccountRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(TenantRepository tenants, UserAccountRepository users,
                       PasswordEncoder passwordEncoder, JwtService jwtService) {
        this.tenants = tenants;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    public AuthDtos.LoginResponse login(AuthDtos.LoginRequest request) {
        Tenant tenant = tenants.findByCode(request.tenantCode().trim())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "租户、用户名或密码错误"));
        UserAccount user = users.findByTenantIdAndUsername(tenant.getId(), request.username().trim())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "租户、用户名或密码错误"));
        if (!"ACTIVE".equals(user.getStatus()) || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "租户、用户名或密码错误");
        }
        String token = jwtService.issue(user);
        return new AuthDtos.LoginResponse(
                token,
                new AuthDtos.UserView(user.getId(), user.getUsername(), user.getDisplayName(), user.getRole()),
                new AuthDtos.TenantView(tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getStatus())
        );
    }
}

