const output = document.getElementById("output");
const moduleList = document.getElementById("moduleList");
const mcqQuestions = document.getElementById("mcqQuestions");

const selectedModuleIdInput = document.getElementById("selectedModuleId");
const submissionIdLabel = document.getElementById("submissionId");
const attemptIdLabel = document.getElementById("attemptId");

let currentQuestions = [];

function headers() {
  const roles = document
    .getElementById("roles")
    .value.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(",");

  return {
    "Content-Type": "application/json",
    "x-user-id": document.getElementById("userId").value,
    "x-user-email": document.getElementById("email").value,
    "x-user-name": document.getElementById("name").value,
    "x-user-department": document.getElementById("department").value,
    "x-user-roles": roles,
  };
}

function log(data) {
  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers ?? {}) },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

document.getElementById("loadMe").addEventListener("click", async () => {
  try {
    const body = await api("/api/me");
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("loadModules").addEventListener("click", async () => {
  try {
    const body = await api("/api/modules");
    moduleList.innerHTML = "";
    for (const module of body.modules) {
      const btn = document.createElement("button");
      btn.textContent = `${module.title} (${module.id})`;
      btn.addEventListener("click", () => {
        selectedModuleIdInput.value = module.id;
        log({ selectedModule: module });
      });
      moduleList.appendChild(btn);
      moduleList.appendChild(document.createElement("br"));
    }
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("createSubmission").addEventListener("click", async () => {
  try {
    const moduleId = selectedModuleIdInput.value;
    if (!moduleId) {
      throw new Error("Select module first.");
    }
    const body = await api("/api/submissions", {
      method: "POST",
      body: JSON.stringify({
        moduleId,
        deliveryType: "text",
        rawText: document.getElementById("rawText").value,
        reflectionText: document.getElementById("reflectionText").value,
        promptExcerpt: document.getElementById("promptExcerpt").value,
        responsibilityAcknowledged: document.getElementById("ack").checked,
      }),
    });
    submissionIdLabel.textContent = body.submission.id;
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("startMcq").addEventListener("click", async () => {
  try {
    const moduleId = selectedModuleIdInput.value;
    const submissionId = submissionIdLabel.textContent;
    if (!moduleId || !submissionId || submissionId === "-") {
      throw new Error("Create submission first.");
    }
    const body = await api(
      `/api/modules/${moduleId}/mcq/start?submissionId=${encodeURIComponent(submissionId)}`,
    );
    attemptIdLabel.textContent = body.attemptId;
    currentQuestions = body.questions;
    renderQuestions();
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("submitMcq").addEventListener("click", async () => {
  try {
    const moduleId = selectedModuleIdInput.value;
    const submissionId = submissionIdLabel.textContent;
    const attemptId = attemptIdLabel.textContent;
    if (!moduleId || !submissionId || !attemptId || attemptId === "-") {
      throw new Error("Start MCQ first.");
    }

    const responses = currentQuestions.map((q) => {
      const selected = document.querySelector(`input[name='q_${q.id}']:checked`);
      return {
        questionId: q.id,
        selectedAnswer: selected ? selected.value : "",
      };
    });

    const body = await api(`/api/modules/${moduleId}/mcq/submit`, {
      method: "POST",
      body: JSON.stringify({
        submissionId,
        attemptId,
        responses,
      }),
    });
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("queueAssessment").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error("Create submission first.");
    }
    const body = await api(`/api/assessments/${submissionId}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("checkAssessment").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error("Create submission first.");
    }
    const body = await api(`/api/assessments/${submissionId}`);
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("checkResult").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error("Create submission first.");
    }
    const body = await api(`/api/submissions/${submissionId}/result`);
    log(body);
  } catch (error) {
    log(error.message);
  }
});

function renderQuestions() {
  mcqQuestions.innerHTML = "";
  for (const question of currentQuestions) {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "12px";
    const title = document.createElement("div");
    title.textContent = question.stem;
    wrapper.appendChild(title);

    for (const option of question.options) {
      const label = document.createElement("label");
      label.style.display = "block";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q_${question.id}`;
      input.value = option;
      label.appendChild(input);
      label.append(` ${option}`);
      wrapper.appendChild(label);
    }

    mcqQuestions.appendChild(wrapper);
  }
}
