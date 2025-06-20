interface Project {
  id: string;
  name: string;
  description?: string;
  client?: string;
  hourly_rate?: number;
  created_at: string;
  user_id: string;
  is_active: boolean;
}

interface TimeEntry {
  id: string;
  project_id: string;
  user_id: string;
  description?: string;
  start_time: string;
  end_time?: string;
  duration?: number;
  created_at: string;
  tags?: string[];
}

interface User {
  id: string;
  email: string;
}

import { API_URL } from "./config";

// DOM Elements
const userEmailElement = document.getElementById("user-email") as HTMLElement;
const loginBtn = document.getElementById("login-btn") as HTMLButtonElement;
const logoutBtn = document.getElementById("logout-btn") as HTMLButtonElement;
const loadingContainer = document.getElementById(
  "loading-container"
) as HTMLDivElement;
const loginContainer = document.getElementById(
  "login-container"
) as HTMLDivElement;
const mainContainer = document.getElementById(
  "main-container"
) as HTMLDivElement;
const loginPromptBtn = document.getElementById(
  "login-prompt-btn"
) as HTMLButtonElement;
const projectSelect = document.getElementById(
  "project-select"
) as HTMLSelectElement;
const newProjectBtn = document.getElementById(
  "new-project-btn"
) as HTMLButtonElement;
const createProjectContainer = document.getElementById(
  "create-project-container"
) as HTMLDivElement;
const projectNameInput = document.getElementById(
  "project-name"
) as HTMLInputElement;
const projectDescriptionInput = document.getElementById(
  "project-description"
) as HTMLTextAreaElement;
const saveProjectBtn = document.getElementById(
  "save-project-btn"
) as HTMLButtonElement;
const cancelProjectBtn = document.getElementById(
  "cancel-project-btn"
) as HTMLButtonElement;
const descriptionInput = document.getElementById(
  "description"
) as HTMLTextAreaElement;
const timerElement = document.getElementById("timer") as HTMLDivElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const entriesList = document.getElementById("entries-list") as HTMLDivElement;
const openDashboardLink = document.getElementById(
  "open-dashboard"
) as HTMLAnchorElement;

// State
let user: User | null = null;
let projects: Project[] = [];
let activeTimeEntry: { id: string; projectId: string } | null = null;
let timerInterval: number | null = null;
let startTime: Date | null = null;

// Initialize the popup
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Popup initialized");
  // Set dashboard URL
  openDashboardLink.href = `${API_URL}/dashboard`;

  // Show loading container, hide other containers
  loadingContainer.style.display = "flex";
  loginContainer.style.display = "none";
  mainContainer.style.display = "none";

  // First check local storage directly for faster initial rendering
  const storageData = await chrome.storage.local.get(["userData", "token"]);
  if (storageData.userData && storageData.token) {
    // We have user data and token in storage, so we're logged in
    user = storageData.userData;
    updateUIForAuthenticatedUser();
    loadProjects();
    checkActiveTimeEntry();
  } else {
    // If not found in storage, check with background script
    await checkAuthStatus();
  }

  // Event listeners
  loginBtn.addEventListener("click", () => {
    console.log("Login button clicked");
    handleLogin();
  });

  loginPromptBtn.addEventListener("click", () => {
    console.log("Login prompt button clicked");
    handleLogin();
  });

  logoutBtn.addEventListener("click", handleLogout);
  startBtn.addEventListener("click", handleStartTimer);
  stopBtn.addEventListener("click", handleStopTimer);
  projectSelect.addEventListener("change", handleProjectChange);

  // Project creation event listeners
  newProjectBtn.addEventListener("click", showCreateProjectForm);
  cancelProjectBtn.addEventListener("click", hideCreateProjectForm);
  saveProjectBtn.addEventListener("click", handleCreateProject);
  projectNameInput.addEventListener("input", validateProjectForm);

  // Listen for auth updates from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "AUTH_UPDATED") {
      if (message.isAuthenticated && message.user) {
        user = message.user;
        updateUIForAuthenticatedUser();
        loadProjects();
        checkActiveTimeEntry();
      } else {
        user = null;
        updateUIForUnauthenticatedUser();
      }
    }

    if (
      message.type === "TIME_ENTRY_STOPPED" &&
      activeTimeEntry &&
      message.timeEntryId === activeTimeEntry.id
    ) {
      activeTimeEntry = null;
      clearTimer();
      startBtn.disabled = false;
      stopBtn.disabled = true;
      projectSelect.disabled = false;
      timerElement.textContent = "00:00:00";
    }
  });

  // If user is logged in, load projects and check for active time entry
  if (user) {
    await loadProjects();
    await checkActiveTimeEntry();
  }
});

// Check if user is authenticated
async function checkAuthStatus() {
  try {
    return new Promise<void>((resolve) => {
      // Ask background script for auth status
      chrome.runtime.sendMessage({ action: "getAuthStatus" }, (response) => {
        if (response && response.isAuthenticated && response.user) {
          // User is authenticated
          user = response.user;
          updateUIForAuthenticatedUser();
          // Load projects and check for active time entry
          loadProjects();
          checkActiveTimeEntry();
        } else {
          updateUIForUnauthenticatedUser();
        }
        resolve();
      });
    });
  } catch (error) {
    console.error("Error checking auth status:", error);
    updateUIForUnauthenticatedUser();
  }
}

// Update UI for authenticated user
function updateUIForAuthenticatedUser() {
  if (!user) return;

  // Hide loading container
  loadingContainer.style.display = "none";

  userEmailElement.textContent = user.email;
  loginBtn.style.display = "none";
  logoutBtn.style.display = "block";
  loginContainer.style.display = "none";
  mainContainer.style.display = "block";
}

// Update UI for unauthenticated user
function updateUIForUnauthenticatedUser() {
  // Hide loading container
  loadingContainer.style.display = "none";

  userEmailElement.textContent = "Not logged in";
  loginBtn.style.display = "block";
  logoutBtn.style.display = "none";
  loginContainer.style.display = "flex";
  mainContainer.style.display = "none";
}

// Handle login
function handleLogin() {
  console.log("handleLogin called");
  // Send message to background script to open login popup
  chrome.runtime.sendMessage({ action: "openLoginPage" }, function (response) {
    console.log("Received response from openLoginPage:", response);
  });
}

// Handle logout
async function handleLogout() {
  // Send logout message to background script
  chrome.runtime.sendMessage({ action: "logout" }, (response) => {
    if (response && response.success) {
      // Update state and UI
      user = null;
      projects = [];
      activeTimeEntry = null;
      clearTimer();
      updateUIForUnauthenticatedUser();
    }
  });
}

// Load projects
async function loadProjects() {
  try {
    // Check if user is authenticated
    if (!user) return;

    // Get token from storage
    const { token } = (await chrome.storage.local.get("token")) as {
      token?: string;
    };
    if (!token) {
      console.error("No auth token found");
      return;
    }

    const response = await fetch(`${API_URL}/api/projects`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      projects = await response.json();
      console.log("Loaded projects:", projects);

      // Clear existing options
      projectSelect.innerHTML = '<option value="">Select a project</option>';

      // Add project options
      let hasActiveProjects = false;
      projects.forEach((project) => {
        if (project.is_active) {
          hasActiveProjects = true;
          const option = document.createElement("option");
          option.value = project.id;
          option.textContent = project.name;
          projectSelect.appendChild(option);
        }
      });

      // Show a hint to create a project if there are no active projects
      if (!hasActiveProjects) {
        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = "No projects found - Create a new one";
        emptyOption.disabled = true;
        projectSelect.innerHTML = "";
        projectSelect.appendChild(emptyOption);
        projectSelect.value = "";
      }
    } else {
      console.error("Failed to load projects:", response.status);
      const errorText = await response.text();
      console.error("Error response:", errorText);
    }
  } catch (error) {
    console.error("Error loading projects:", error);
  }
}

// Check for active time entry
async function checkActiveTimeEntry() {
  try {
    // Check if user is authenticated
    if (!user) return;

    // Get token from storage
    const { token } = (await chrome.storage.local.get("token")) as {
      token?: string;
    };
    if (!token) {
      console.error("No auth token found");
      return;
    }

    const response = await fetch(`${API_URL}/api/time-entries/active`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();

      if (data) {
        // There is an active time entry
        activeTimeEntry = {
          id: data.id,
          projectId: data.project_id,
        };

        // Set project and description
        projectSelect.value = data.project_id;
        descriptionInput.value = data.description || "";

        // Start timer
        startTime = new Date(data.start_time);
        startTimer();

        // Update UI
        startBtn.disabled = true;
        stopBtn.disabled = false;
        projectSelect.disabled = true;
      }
    }
  } catch (error) {
    console.error("Error checking active time entry:", error);
  }
}

// Handle project change
function handleProjectChange() {
  const projectId = projectSelect.value;

  if (projectId) {
    startBtn.disabled = false;
  } else {
    startBtn.disabled = true;
  }
}

// Handle start timer
async function handleStartTimer() {
  const projectId = projectSelect.value;
  const description = descriptionInput.value;

  if (!projectId) return;

  try {
    // Check if user is authenticated
    if (!user) return;

    // Get token from storage
    const { token } = (await chrome.storage.local.get("token")) as {
      token?: string;
    };
    if (!token) {
      console.error("No auth token found");
      return;
    }

    const response = await fetch(`${API_URL}/api/time-entries`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project_id: projectId,
        description,
        start_time: new Date().toISOString(),
      }),
    });

    if (response.ok) {
      const data = await response.json();

      // Update state
      activeTimeEntry = {
        id: data.id,
        projectId,
      };

      // Start timer
      startTime = new Date();
      startTimer();

      // Update UI
      startBtn.disabled = true;
      stopBtn.disabled = false;
      projectSelect.disabled = true;
    }
  } catch (error) {
    console.error("Error starting timer:", error);
  }
}

// Handle stop timer
async function handleStopTimer() {
  if (!activeTimeEntry) return;

  try {
    // Check if user is authenticated
    if (!user) return;

    // Get token from storage
    const { token } = (await chrome.storage.local.get("token")) as {
      token?: string;
    };
    if (!token) {
      console.error("No auth token found");
      return;
    }

    // Update the time entry with end time and description
    const response = await fetch(
      `${API_URL}/api/time-entries/${activeTimeEntry.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: descriptionInput.value,
          end_time: new Date().toISOString(),
        }),
      }
    );

    if (response.ok) {
      // Clear state
      activeTimeEntry = null;
      clearTimer();

      // Update UI
      startBtn.disabled = false;
      stopBtn.disabled = true;
      projectSelect.disabled = false;
      timerElement.textContent = "00:00:00";
    }
  } catch (error) {
    console.error("Error stopping timer:", error);
  }
}

// Start timer
function startTimer() {
  if (!startTime) return;

  // Update timer immediately
  updateTimer();

  // Update timer every second
  timerInterval = window.setInterval(updateTimer, 1000);
}

// Update timer display
function updateTimer() {
  if (!startTime) return;

  const now = new Date();
  const diffInSeconds = Math.floor(
    (now.getTime() - startTime.getTime()) / 1000
  );

  const hours = Math.floor(diffInSeconds / 3600);
  const minutes = Math.floor((diffInSeconds % 3600) / 60);
  const seconds = diffInSeconds % 60;

  timerElement.textContent = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// Clear timer
function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  startTime = null;
}

// Format duration in seconds to "Xh Ym" format
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${hours}h ${minutes}m`;
}

// Format date to "MMM DD, YYYY" format
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Show the create project form
function showCreateProjectForm() {
  // Hide the timer and description input
  document.querySelector(".description-input")?.classList.add("hidden");
  document.querySelector(".timer-display")?.classList.add("hidden");

  // Show the create project form
  createProjectContainer.style.display = "block";

  // Clear form fields
  projectNameInput.value = "";
  projectDescriptionInput.value = "";

  // Focus on the project name input
  projectNameInput.focus();

  // Disable the save button initially
  saveProjectBtn.disabled = true;
}

// Hide the create project form
function hideCreateProjectForm() {
  // Show the timer and description input
  document.querySelector(".description-input")?.classList.remove("hidden");
  document.querySelector(".timer-display")?.classList.remove("hidden");

  // Hide the create project form
  createProjectContainer.style.display = "none";
}

// Validate the project form
function validateProjectForm() {
  // Enable the save button only if the project name is not empty
  saveProjectBtn.disabled = !projectNameInput.value.trim();
}

// Handle create project
async function handleCreateProject() {
  try {
    // Check if user is authenticated
    if (!user) return;

    // Validate form
    const projectName = projectNameInput.value.trim();
    if (!projectName) {
      alert("Project name is required");
      return;
    }

    // Get token from storage
    const { token } = (await chrome.storage.local.get("token")) as {
      token?: string;
    };
    if (!token) {
      console.error("No auth token found");
      return;
    }

    // Show loading state
    saveProjectBtn.disabled = true;
    saveProjectBtn.textContent = "Creating...";

    // Create the project
    const response = await fetch(`${API_URL}/api/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        description: projectDescriptionInput.value.trim(),
        is_active: true,
      }),
    });

    if (response.ok) {
      const newProject = await response.json();
      console.log("Created project:", newProject);

      // Add the new project to the projects array
      projects.push(newProject);

      // Add the new project to the select dropdown
      const option = document.createElement("option");
      option.value = newProject.id;
      option.textContent = newProject.name;
      projectSelect.appendChild(option);

      // Select the new project
      projectSelect.value = newProject.id;

      // Enable the start button
      startBtn.disabled = false;

      // Hide the create project form
      hideCreateProjectForm();

      // Show success message
      const successMessage = document.createElement("div");
      successMessage.className = "success-message";
      successMessage.textContent = `Project "${newProject.name}" created successfully!`;
      mainContainer.insertBefore(successMessage, createProjectContainer);

      // Remove the success message after 3 seconds
      setTimeout(() => {
        successMessage.remove();
      }, 3000);
    } else {
      console.error("Failed to create project:", response.status);
      const errorText = await response.text();
      console.error("Error response:", errorText);
      alert("Failed to create project. Please try again.");
    }
  } catch (error) {
    console.error("Error creating project:", error);
    alert("An error occurred while creating the project.");
  } finally {
    // Reset button state
    saveProjectBtn.disabled = false;
    saveProjectBtn.textContent = "Create Project";
  }
}
