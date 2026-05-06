import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEYS = {
  ATTENDANCE: "@hrms_attendance",
  LEAVES: "@hrms_leaves",
  TASKS: "@hrms_tasks",
  NOTIFICATIONS: "@hrms_notifications",
  PROJECTS: "@hrms_projects",
  PAYROLL: "@hrms_payroll",
  DOCUMENTS: "@hrms_documents",
  OFFLINE_QUEUE: "@hrms_offline_queue",
  SETTINGS: "@hrms_settings",
} as const;

export interface AttendanceRecord {
  id: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status: "present" | "absent" | "late" | "wfh" | "leave";
  location?: { latitude: number; longitude: number };
  selfieUri?: string;
  notes?: string;
}

export interface LeaveRequest {
  id: string;
  type: "sick" | "casual" | "earned" | "wfh";
  startDate: string;
  endDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  appliedOn: string;
  documentUri?: string;
  approvedBy?: string;
  approvedOn?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type:
    | "follow_up"
    | "site_visit"
    | "lead"
    | "document"
    | "marketing"
    | "other";
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed" | "cancelled";
  assignedTo: string;
  assignedBy: string;
  deadline: string;
  createdAt: string;
  completedAt?: string;
  location?: { latitude: number; longitude: number; address: string };
  attachments?: string[];
  notes?: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string; // open string to support all DB notification types
  read: boolean;
  createdAt: string;
  actionUrl?: string;
}

export interface Project {
  id: string;
  name: string;
  location: string;
  address: string;
  price: string;
  pricePerSqft?: string;
  type: "residential" | "commercial" | "plots";
  status: "available" | "sold_out" | "upcoming";
  amenities: string[];
  description: string;
  imageUri?: string;
  brochureUri?: string;
  coordinates?: { latitude: number; longitude: number };
}

export interface PayrollRecord {
  id: string;
  month: string;
  year: number;
  basicSalary: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  status: "pending" | "processed" | "paid";
  paidOn?: string;
}

export interface Document {
  id: string;
  name: string;
  category: "personal" | "hr" | "property" | "certificate";
  uri: string;
  size: number;
  uploadedAt: string;
  type: string;
}

async function getItem<T>(key: string): Promise<T | null> {
  try {
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`Error reading ${key}:`, error);
    return null;
  }
}

async function setItem<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error saving ${key}:`, error);
  }
}

export const AttendanceStorage = {
  async getAll(): Promise<AttendanceRecord[]> {
    return (await getItem<AttendanceRecord[]>(STORAGE_KEYS.ATTENDANCE)) || [];
  },
  async add(record: AttendanceRecord): Promise<void> {
    const records = await this.getAll();
    records.unshift(record);
    await setItem(STORAGE_KEYS.ATTENDANCE, records);
  },
  async update(id: string, updates: Partial<AttendanceRecord>): Promise<void> {
    const records = await this.getAll();
    const index = records.findIndex((r) => r.id === id);
    if (index !== -1) {
      records[index] = { ...records[index], ...updates };
      await setItem(STORAGE_KEYS.ATTENDANCE, records);
    }
  },
  async getTodayRecord(): Promise<AttendanceRecord | null> {
    const records = await this.getAll();
    const today = new Date().toISOString().split("T")[0];
    return records.find((r) => r.date === today) || null;
  },
};

export const LeaveStorage = {
  async getAll(): Promise<LeaveRequest[]> {
    return (await getItem<LeaveRequest[]>(STORAGE_KEYS.LEAVES)) || [];
  },
  async add(request: LeaveRequest): Promise<void> {
    const requests = await this.getAll();
    requests.unshift(request);
    await setItem(STORAGE_KEYS.LEAVES, requests);
  },
  async update(id: string, updates: Partial<LeaveRequest>): Promise<void> {
    const requests = await this.getAll();
    const index = requests.findIndex((r) => r.id === id);
    if (index !== -1) {
      requests[index] = { ...requests[index], ...updates };
      await setItem(STORAGE_KEYS.LEAVES, requests);
    }
  },
  async getBalance(): Promise<{
    sick: number;
    casual: number;
    earned: number;
  }> {
    const requests = await this.getAll();
    const approved = requests.filter((r) => r.status === "approved");
    const usedSick = approved.filter((r) => r.type === "sick").length;
    const usedCasual = approved.filter((r) => r.type === "casual").length;
    const usedEarned = approved.filter((r) => r.type === "earned").length;
    return {
      sick: Math.max(0, 12 - usedSick),
      casual: Math.max(0, 12 - usedCasual),
      earned: Math.max(0, 15 - usedEarned),
    };
  },
};

export const TaskStorage = {
  async getAll(): Promise<Task[]> {
    return (await getItem<Task[]>(STORAGE_KEYS.TASKS)) || [];
  },
  async add(task: Task): Promise<void> {
    const tasks = await this.getAll();
    tasks.unshift(task);
    await setItem(STORAGE_KEYS.TASKS, tasks);
  },
  async update(id: string, updates: Partial<Task>): Promise<void> {
    const tasks = await this.getAll();
    const index = tasks.findIndex((t) => t.id === id);
    if (index !== -1) {
      tasks[index] = { ...tasks[index], ...updates };
      await setItem(STORAGE_KEYS.TASKS, tasks);
    }
  },
  async delete(id: string): Promise<void> {
    const tasks = await this.getAll();
    await setItem(
      STORAGE_KEYS.TASKS,
      tasks.filter((t) => t.id !== id),
    );
  },
  async getByStatus(status: Task["status"]): Promise<Task[]> {
    const tasks = await this.getAll();
    return tasks.filter((t) => t.status === status);
  },
};

export const NotificationStorage = {
  async getAll(): Promise<Notification[]> {
    return (await getItem<Notification[]>(STORAGE_KEYS.NOTIFICATIONS)) || [];
  },
  async add(notification: Notification): Promise<void> {
    const notifications = await this.getAll();
    notifications.unshift(notification);
    await setItem(STORAGE_KEYS.NOTIFICATIONS, notifications);
  },
  async markAsRead(id: string): Promise<void> {
    const notifications = await this.getAll();
    const index = notifications.findIndex((n) => n.id === id);
    if (index !== -1) {
      notifications[index].read = true;
      await setItem(STORAGE_KEYS.NOTIFICATIONS, notifications);
    }
  },
  async markAllAsRead(): Promise<void> {
    const notifications = await this.getAll();
    notifications.forEach((n) => (n.read = true));
    await setItem(STORAGE_KEYS.NOTIFICATIONS, notifications);
  },
  async getUnreadCount(): Promise<number> {
    const notifications = await this.getAll();
    return notifications.filter((n) => !n.read).length;
  },
  async clear(): Promise<void> {
    await setItem(STORAGE_KEYS.NOTIFICATIONS, []);
  },
};

export const ProjectStorage = {
  async getAll(): Promise<Project[]> {
    return (await getItem<Project[]>(STORAGE_KEYS.PROJECTS)) || [];
  },
  async add(project: Project): Promise<void> {
    const projects = await this.getAll();
    projects.unshift(project);
    await setItem(STORAGE_KEYS.PROJECTS, projects);
  },
  async update(id: string, updates: Partial<Project>): Promise<void> {
    const projects = await this.getAll();
    const index = projects.findIndex((p) => p.id === id);
    if (index !== -1) {
      projects[index] = { ...projects[index], ...updates };
      await setItem(STORAGE_KEYS.PROJECTS, projects);
    }
  },
  async delete(id: string): Promise<void> {
    const projects = await this.getAll();
    await setItem(
      STORAGE_KEYS.PROJECTS,
      projects.filter((p) => p.id !== id),
    );
  },
};

export const PayrollStorage = {
  async getAll(): Promise<PayrollRecord[]> {
    return (await getItem<PayrollRecord[]>(STORAGE_KEYS.PAYROLL)) || [];
  },
  async add(record: PayrollRecord): Promise<void> {
    const records = await this.getAll();
    records.unshift(record);
    await setItem(STORAGE_KEYS.PAYROLL, records);
  },
  async getCurrentMonth(): Promise<PayrollRecord | null> {
    const records = await this.getAll();
    const now = new Date();
    const currentMonth = now.toLocaleString("default", { month: "long" });
    const currentYear = now.getFullYear();
    return (
      records.find((r) => r.month === currentMonth && r.year === currentYear) ||
      null
    );
  },
};

export const DocumentStorage = {
  async getAll(): Promise<Document[]> {
    return (await getItem<Document[]>(STORAGE_KEYS.DOCUMENTS)) || [];
  },
  async add(doc: Document): Promise<void> {
    const docs = await this.getAll();
    docs.unshift(doc);
    await setItem(STORAGE_KEYS.DOCUMENTS, docs);
  },
  async delete(id: string): Promise<void> {
    const docs = await this.getAll();
    await setItem(
      STORAGE_KEYS.DOCUMENTS,
      docs.filter((d) => d.id !== id),
    );
  },
  async getByCategory(category: Document["category"]): Promise<Document[]> {
    const docs = await this.getAll();
    return docs.filter((d) => d.category === category);
  },
};

export async function initializeMockData(userId: string): Promise<void> {
  const existingTasks = await TaskStorage.getAll();
  if (existingTasks.length === 0) {
    const mockTasks: Task[] = [
      {
        id: "task_1",
        title: "Client Follow-up - Sharma Family",
        description:
          "Follow up with Mr. Sharma regarding 3BHK flat in Green Valley project",
        type: "follow_up",
        priority: "high",
        status: "pending",
        assignedTo: userId,
        assignedBy: "manager_1",
        deadline: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: "task_2",
        title: "Site Visit - Palm Heights",
        description:
          "Conduct site visit with potential buyers at Palm Heights project",
        type: "site_visit",
        priority: "medium",
        status: "in_progress",
        assignedTo: userId,
        assignedBy: "manager_1",
        deadline: new Date(Date.now() + 172800000).toISOString(),
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        location: {
          latitude: 28.6139,
          longitude: 77.209,
          address: "Palm Heights, Sector 45, Gurgaon",
        },
      },
      {
        id: "task_3",
        title: "Document Verification - Patel Deal",
        description: "Verify all property documents for Patel family purchase",
        type: "document",
        priority: "high",
        status: "pending",
        assignedTo: userId,
        assignedBy: "hr_1",
        deadline: new Date(Date.now() + 259200000).toISOString(),
        createdAt: new Date(Date.now() - 43200000).toISOString(),
      },
    ];
    for (const task of mockTasks) {
      await TaskStorage.add(task);
    }
  }

  const existingProjects = await ProjectStorage.getAll();
  if (existingProjects.length === 0) {
    const mockProjects: Project[] = [
      {
        id: "proj_1",
        name: "Green Valley Residences",
        location: "Sector 45, Gurgaon",
        address: "Plot No. 45, Sector 45, Gurgaon, Haryana 122003",
        price: "Rs 1.2 Cr - 2.5 Cr",
        pricePerSqft: "Rs 8,500/sqft",
        type: "residential",
        status: "available",
        amenities: [
          "Swimming Pool",
          "Gym",
          "Club House",
          "Park",
          "24/7 Security",
          "Power Backup",
        ],
        description:
          "Premium 2/3/4 BHK apartments with world-class amenities in the heart of Gurgaon.",
      },
      {
        id: "proj_2",
        name: "Palm Heights",
        location: "Noida Extension",
        address: "Sector 16, Greater Noida West, UP 201306",
        price: "Rs 65 Lac - 1.1 Cr",
        pricePerSqft: "Rs 5,200/sqft",
        type: "residential",
        status: "available",
        amenities: ["Garden", "Gym", "Parking", "Security", "Club House"],
        description:
          "Affordable luxury apartments with excellent connectivity to Delhi NCR.",
      },
      {
        id: "proj_3",
        name: "Business Bay Plaza",
        location: "Cyber City, Gurgaon",
        address: "DLF Cyber City, Gurgaon, Haryana 122002",
        price: "Rs 2.5 Cr - 8 Cr",
        pricePerSqft: "Rs 15,000/sqft",
        type: "commercial",
        status: "upcoming",
        amenities: [
          "Conference Rooms",
          "Cafeteria",
          "Parking",
          "24/7 Security",
          "High-speed Internet",
        ],
        description:
          "Premium commercial spaces in prime location with excellent corporate infrastructure.",
      },
    ];
    for (const project of mockProjects) {
      await ProjectStorage.add(project);
    }
  }

  const existingNotifications = await NotificationStorage.getAll();
  if (existingNotifications.length === 0) {
    const mockNotifications: Notification[] = [
      {
        id: "notif_1",
        title: "New Task Assigned",
        message: "You have been assigned a new client follow-up task",
        type: "task",
        read: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "notif_2",
        title: "Salary Processed",
        message: "Your November salary has been processed",
        type: "payroll",
        read: false,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: "notif_3",
        title: "Team Meeting",
        message: "Weekly team meeting scheduled for tomorrow at 10 AM",
        type: "reminder",
        read: true,
        createdAt: new Date(Date.now() - 172800000).toISOString(),
      },
    ];
    for (const notification of mockNotifications) {
      await NotificationStorage.add(notification);
    }
  }

  const existingPayroll = await PayrollStorage.getAll();
  if (existingPayroll.length === 0) {
    const months = ["November", "October", "September"];
    const mockPayroll: PayrollRecord[] = months.map((month, index) => ({
      id: `payroll_${index + 1}`,
      month,
      year: 2024,
      basicSalary: 45000,
      allowances: 15000,
      deductions: 8000,
      netSalary: 52000,
      status: index === 0 ? "processed" : "paid",
      paidOn:
        index > 0
          ? new Date(Date.now() - index * 30 * 86400000).toISOString()
          : undefined,
    }));
    for (const record of mockPayroll) {
      await PayrollStorage.add(record);
    }
  }
}
