package com.linlituan.saas.form;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlituan.saas.audit.AuditService;
import com.linlituan.saas.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class FormService {
    private static final List<String> TYPES = List.of("text", "textarea", "radio", "checkbox", "rating", "number");
    private final FormRepository forms;
    private final FormSubmissionRepository submissions;
    private final ObjectMapper objectMapper;
    private final AuditService audit;

    public FormService(FormRepository forms, FormSubmissionRepository submissions,
                       ObjectMapper objectMapper, AuditService audit) {
        this.forms = forms;
        this.submissions = submissions;
        this.objectMapper = objectMapper;
        this.audit = audit;
    }

    @Transactional
    public FormEntity create(Long tenantId, FormDtos.CreateRequest request) {
        FormEntity form = new FormEntity();
        form.setTenantId(tenantId);
        form.setTitle(request.title().trim());
        form.setDescription(request.description() == null ? "" : request.description());
        form.setStatus("closed".equalsIgnoreCase(request.status()) ? "CLOSED" : "OPEN");
        form.setFieldsJson(write(normalizeFields(request.fields())));
        forms.save(form);
        audit.record("form.create", "form", String.valueOf(form.getId()), Map.of("title", form.getTitle()));
        return form;
    }

    public List<FormEntity> list(Long tenantId) {
        return forms.findByTenantIdOrderByCreatedAtDesc(tenantId);
    }

    public FormEntity get(Long tenantId, Long id) {
        return forms.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "表单不存在"));
    }

    @Transactional
    public FormEntity update(Long tenantId, Long id, FormDtos.UpdateRequest request) {
        FormEntity form = get(tenantId, id);
        if (request.title() != null) form.setTitle(request.title().trim());
        if (request.description() != null) form.setDescription(request.description());
        if (request.status() != null) form.setStatus("closed".equalsIgnoreCase(request.status()) ? "CLOSED" : "OPEN");
        if (request.fields() != null) form.setFieldsJson(write(normalizeFields(request.fields())));
        forms.save(form);
        audit.record("form.update", "form", String.valueOf(id), Map.of("title", form.getTitle(), "status", form.getStatus()));
        return form;
    }

    @Transactional
    public FormSubmission submit(Long tenantId, Long formId, Long memberId, FormDtos.SubmitRequest request) {
        FormEntity form = get(tenantId, formId);
        if (!"OPEN".equals(form.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "FORM_CLOSED", "表单已关闭");
        }
        if (submissions.existsByFormIdAndMemberId(formId, memberId)) {
            throw new ApiException(HttpStatus.CONFLICT, "FORM_DUPLICATE", "您已提交过该表单");
        }
        List<FormDtos.FieldDefinition> fields = readFields(form.getFieldsJson());
        Map<String, Object> answers = request.answers() == null ? Map.of() : request.answers();
        for (FormDtos.FieldDefinition field : fields) {
            Object value = answers.get(field.id());
            if (field.required() && empty(value)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "FORM_REQUIRED", "必填项未填写: " + field.label());
            }
        }
        FormSubmission submission = new FormSubmission();
        submission.setTenantId(tenantId);
        submission.setFormId(formId);
        submission.setMemberId(memberId);
        submission.setAnswersJson(write(answers));
        submissions.save(submission);
        audit.record("form.submit", "form", String.valueOf(formId), Map.of("memberId", memberId));
        return submission;
    }

    public FormDtos.StatsView stats(Long tenantId, Long formId) {
        FormEntity form = get(tenantId, formId);
        List<FormSubmission> list = submissions.findByFormIdOrderByCreatedAtDesc(formId);
        List<FormDtos.FieldStats> fields = new ArrayList<>();
        for (FormDtos.FieldDefinition field : readFields(form.getFieldsJson())) {
            Map<String, Long> distribution = new LinkedHashMap<>();
            double sum = 0;
            long count = 0;
            for (FormSubmission submission : list) {
                Object value = readAnswers(submission.getAnswersJson()).get(field.id());
                if (empty(value)) continue;
                if ("radio".equals(field.type()) || "text".equals(field.type()) || "textarea".equals(field.type())) {
                    distribution.merge(String.valueOf(value), 1L, Long::sum);
                } else if ("checkbox".equals(field.type()) && value instanceof List<?> values) {
                    for (Object item : values) distribution.merge(String.valueOf(item), 1L, Long::sum);
                } else if ("rating".equals(field.type()) || "number".equals(field.type())) {
                    try { sum += Double.parseDouble(String.valueOf(value)); count++; } catch (NumberFormatException ignored) {}
                }
            }
            fields.add(new FormDtos.FieldStats(field.id(), field.label(), field.type(), distribution,
                    count == 0 ? null : Math.round(sum / count * 10) / 10.0, list.size()));
        }
        return new FormDtos.StatsView(form.getId(), form.getTitle(), list.size(), fields);
    }

    public FormDtos.FormView view(FormEntity form) {
        return new FormDtos.FormView(form.getId(), form.getTitle(), form.getDescription(),
                readFields(form.getFieldsJson()), form.getStatus(), form.getCreatedAt());
    }

    private List<FormDtos.FieldDefinition> normalizeFields(List<FormDtos.FieldDefinition> fields) {
        if (fields == null) return List.of();
        List<FormDtos.FieldDefinition> result = new ArrayList<>();
        for (int i = 0; i < fields.size(); i++) {
            FormDtos.FieldDefinition field = fields.get(i);
            String type = TYPES.contains(field.type()) ? field.type() : "text";
            List<String> options = field.options() == null ? List.of() : field.options().stream().limit(20).toList();
            result.add(new FormDtos.FieldDefinition(
                    field.id() == null || field.id().isBlank() ? "f" + (i + 1) : field.id(),
                    field.label(), type, options, field.required()));
        }
        return result;
    }

    private boolean empty(Object value) {
        return value == null || (value instanceof String string && string.isBlank())
                || (value instanceof List<?> list && list.isEmpty());
    }

    private String write(Object value) {
        try { return objectMapper.writeValueAsString(value); }
        catch (Exception ex) { throw new IllegalArgumentException("JSON 序列化失败", ex); }
    }

    private List<FormDtos.FieldDefinition> readFields(String value) {
        try { return objectMapper.readValue(value, new TypeReference<>() {}); }
        catch (Exception ex) { return List.of(); }
    }

    private Map<String, Object> readAnswers(String value) {
        try { return objectMapper.readValue(value, new TypeReference<>() {}); }
        catch (Exception ex) { return Map.of(); }
    }
}

