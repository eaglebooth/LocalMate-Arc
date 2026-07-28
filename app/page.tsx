"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeFunctionResult, encodeFunctionData, formatUnits, keccak256, parseUnits, toBytes } from "viem";
import deploymentV3 from "../public/arc-v3-deployment.json";
import CircleWalletModal from "./CircleWalletModal";
import ExternalWalletModal, { type Eip1193Provider } from "./ExternalWalletModal";
import { reownAppKit } from "./reown-appkit";
import {
  circleAction,
  clearCircleWalletSession,
  executeCircleChallenge,
  getCircleWalletSession,
} from "./circle-wallet-session";

type Helper = {
  name: string;
  initials: string;
  role: string;
  trust: number;
  match: number;
  jobs: number;
  repeat: string;
  price: string;
  tone: string;
  skills: string[];
  note: string;
  categories: string[];
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type JobStage = "review" | "open" | "assigned";
type UserRole = "resident" | "helper";
type LiveStage = "idle" | "funded" | "assigned" | "submitted" | "disputed" | "completed" | "rejected" | "cancelled";

type LiveJobRecord = {
  id: bigint;
  client: string;
  provider: string;
  evaluator: string;
  budget: bigint;
  expiresAt: bigint;
  status: number;
  requirementsHash: string;
  task?: string;
};

type LiveApplication = {
  jobId: string;
  provider: string;
  signature: string;
  applicationHash: string;
  appliedAt: string;
};

type EvidenceRecord = {
  uri: string;
  evidenceHash: string;
  name: string;
  size: number;
  type: string;
};

const v3Abi = [
  { type: "function", name: "nextJobId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "jobs", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "budget", type: "uint128" }, { name: "workDeadline", type: "uint64" }, { name: "submittedAt", type: "uint64" }, { name: "status", type: "uint8" }, { name: "requirementsHash", type: "bytes32" }, { name: "applicationHash", type: "bytes32" }, { name: "evidenceHash", type: "bytes32" }, { name: "evidenceUriHash", type: "bytes32" }, { name: "disputeHash", type: "bytes32" }] },
  { type: "function", name: "createJob", stateMutability: "nonpayable", inputs: [{ name: "evaluator", type: "address" }, { name: "budget", type: "uint128" }, { name: "expiresAt", type: "uint64" }, { name: "requirementsHash", type: "bytes32" }], outputs: [{ name: "jobId", type: "uint256" }] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "applicationDigest", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }, { name: "provider", type: "address" }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "assignProvider", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "provider", type: "address" }, { name: "providerSignature", type: "bytes" }], outputs: [] },
  { type: "function", name: "submitEvidence", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "evidenceHash", type: "bytes32" }, { name: "evidenceUriHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "complete", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "reject", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "reasonHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "raiseDispute", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "reasonHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "resolveDispute", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "providerShareBps", type: "uint16" }], outputs: [] },
  { type: "function", name: "cancelUnassigned", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
] as const;

const usdcAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const LIVE_SESSION_KEY = "localmate-live-session-v3";
const LIVE_JOBS_KEY = "localmate-live-job-metadata-v3";
const LIVE_APPLICATIONS_KEY = "localmate-live-applications-v3";

const services = [
  { icon: "🐕", name: "Pet care", sub: "Walks, visits & sitting", color: "mint" },
  { icon: "✦", name: "Home cleaning", sub: "Everyday & deep clean", color: "coral" },
  { icon: "⌁", name: "Repairs", sub: "Fix, mount & assemble", color: "yellow" },
  { icon: "↗", name: "Moving help", sub: "Lift, pack & rearrange", color: "blue" },
  { icon: "✓", name: "Everyday errands", sub: "Pickups, plants & more", color: "lilac" },
  { icon: "♡", name: "Senior companionship", sub: "Visits, walks & daily support", color: "mint" },
];

const helpers: Helper[] = [
  {
    name: "Minh Trần",
    initials: "MT",
    role: "Pet care specialist",
    trust: 94,
    match: 97,
    jobs: 38,
    repeat: "72%",
    price: "6 USDC/hr",
    tone: "green",
    skills: ["ID verified", "Same building", "Dog care"],
    note: "Best match · 12 pet-care jobs, zero cancellations in 90 days.",
    categories: ["pet"],
  },
  {
    name: "Linh Phạm",
    initials: "LP",
    role: "Home & pet helper",
    trust: 91,
    match: 92,
    jobs: 54,
    repeat: "68%",
    price: "7 USDC/hr",
    tone: "orange",
    skills: ["ID verified", "Top rated", "First aid"],
    note: "Highly trusted · Frequently rehired by pet owners nearby.",
    categories: ["pet", "cleaning"],
  },
  {
    name: "Quân Nguyễn",
    initials: "QN",
    role: "Local all-rounder",
    trust: 86,
    match: 88,
    jobs: 21,
    repeat: "57%",
    price: "5 USDC/hr",
    tone: "blue",
    skills: ["ID verified", "Nearby", "Flexible"],
    note: "Great value · Available at your requested time and budget.",
    categories: ["pet", "errands"],
  },
  { name: "Thảo Lê", initials: "TL", role: "Cat & small pet sitter", trust: 93, match: 94, jobs: 46, repeat: "74%", price: "6 USDC/hr", tone: "orange", skills: ["ID verified", "Cat care", "Medication"], note: "Experienced with cats and medication routines; available tomorrow.", categories: ["pet"] },
  { name: "Huyền Đỗ", initials: "HĐ", role: "Dog walker & sitter", trust: 89, match: 91, jobs: 29, repeat: "63%", price: "5 USDC/hr", tone: "blue", skills: ["Community verified", "Large dogs", "Nearby"], note: "Strong experience with large dogs and lives two towers away.", categories: ["pet"] },
  { name: "Đức Võ", initials: "ĐV", role: "Evening pet helper", trust: 84, match: 87, jobs: 17, repeat: "59%", price: "4 USDC/hr", tone: "green", skills: ["ID verified", "Evenings", "Flexible"], note: "Best budget fit with reliable evening availability.", categories: ["pet", "errands"] },

  { name: "Mai Nguyễn", initials: "MN", role: "Home cleaning specialist", trust: 96, match: 98, jobs: 78, repeat: "81%", price: "8 USDC/hr", tone: "green", skills: ["ID verified", "Deep clean", "Top rated"], note: "Top cleaning match with 78 verified jobs and an 81% rehire rate.", categories: ["cleaning"] },
  { name: "Hà Phan", initials: "HP", role: "Apartment cleaner", trust: 92, match: 95, jobs: 62, repeat: "76%", price: "7 USDC/hr", tone: "orange", skills: ["Community verified", "Eco products", "Same tower"], note: "Same-tower helper who brings eco-friendly cleaning supplies.", categories: ["cleaning"] },
  { name: "Yến Trương", initials: "YT", role: "Deep clean & organizing", trust: 90, match: 93, jobs: 51, repeat: "71%", price: "7 USDC/hr", tone: "blue", skills: ["ID verified", "Organizing", "Move-out"], note: "Excellent for deep cleaning, organizing and move-out preparation.", categories: ["cleaning", "moving"] },
  { name: "Oanh Bùi", initials: "OB", role: "Everyday home helper", trust: 87, match: 90, jobs: 34, repeat: "66%", price: "5 USDC/hr", tone: "green", skills: ["ID verified", "Laundry", "Flexible"], note: "Affordable everyday cleaning with flexible weekday availability.", categories: ["cleaning", "errands"] },
  { name: "Trang Hồ", initials: "TH", role: "Kitchen & bathroom cleaner", trust: 91, match: 92, jobs: 43, repeat: "69%", price: "6 USDC/hr", tone: "orange", skills: ["ID verified", "Sanitizing", "Top rated"], note: "Specializes in kitchens and bathrooms with consistently strong reviews.", categories: ["cleaning"] },
  { name: "Lan Vũ", initials: "LV", role: "Home organizer", trust: 85, match: 88, jobs: 26, repeat: "61%", price: "5 USDC/hr", tone: "blue", skills: ["Community verified", "Wardrobes", "Declutter"], note: "A practical choice for wardrobes, storage and decluttering.", categories: ["cleaning", "errands"] },

  { name: "Tuấn Hoàng", initials: "TH", role: "Furniture repair expert", trust: 95, match: 98, jobs: 83, repeat: "79%", price: "10 USDC/hr", tone: "green", skills: ["ID verified", "Furniture", "Tools included"], note: "Top repair match with proven furniture work and all tools included.", categories: ["repairs"] },
  { name: "Nam Đặng", initials: "NĐ", role: "Mounting & assembly", trust: 93, match: 96, jobs: 69, repeat: "75%", price: "9 USDC/hr", tone: "orange", skills: ["Community verified", "Mounting", "Assembly"], note: "Highly experienced in shelves, TV mounts and flat-pack assembly.", categories: ["repairs"] },
  { name: "Khoa Lâm", initials: "KL", role: "Smart-home installer", trust: 91, match: 94, jobs: 58, repeat: "73%", price: "9 USDC/hr", tone: "blue", skills: ["ID verified", "Smart home", "Wi-Fi setup"], note: "Best fit for smart devices, Wi-Fi and home technology setup.", categories: ["repairs"] },
  { name: "Sơn Phạm", initials: "SP", role: "General handyman", trust: 88, match: 92, jobs: 47, repeat: "67%", price: "7 USDC/hr", tone: "green", skills: ["ID verified", "Minor repairs", "Same building"], note: "Same-building handyman for quick fixes and small installations.", categories: ["repairs", "moving"] },
  { name: "Vinh Trần", initials: "VT", role: "Appliance & fixture helper", trust: 86, match: 89, jobs: 31, repeat: "64%", price: "7 USDC/hr", tone: "orange", skills: ["Community verified", "Fixtures", "Appliances"], note: "Reliable for basic fixture and appliance installation tasks.", categories: ["repairs"] },
  { name: "Bảo Nguyễn", initials: "BN", role: "Furniture assembler", trust: 83, match: 87, jobs: 22, repeat: "58%", price: "6 USDC/hr", tone: "blue", skills: ["ID verified", "Assembly", "Budget fit"], note: "Good budget option for desks, shelves and simple furniture.", categories: ["repairs", "moving"] },

  { name: "Phúc Lý", initials: "PL", role: "Moving team lead", trust: 95, match: 98, jobs: 91, repeat: "77%", price: "11 USDC/hr", tone: "green", skills: ["ID verified", "Team lead", "Heavy lifting"], note: "Top moving match; leads a verified two-person team for heavy items.", categories: ["moving"] },
  { name: "Long Trịnh", initials: "LT", role: "Heavy-item mover", trust: 92, match: 96, jobs: 74, repeat: "72%", price: "9 USDC/hr", tone: "orange", skills: ["Community verified", "Equipment", "Same tower"], note: "Has moving straps and trolley equipment; available in the same tower.", categories: ["moving"] },
  { name: "Duy Cao", initials: "DC", role: "Packing & moving helper", trust: 89, match: 93, jobs: 55, repeat: "68%", price: "8 USDC/hr", tone: "blue", skills: ["ID verified", "Packing", "Careful handling"], note: "Strong reviews for careful packing and damage-free handling.", categories: ["moving"] },
  { name: "Khánh Vũ", initials: "KV", role: "Furniture mover", trust: 87, match: 91, jobs: 42, repeat: "65%", price: "8 USDC/hr", tone: "green", skills: ["ID verified", "Furniture", "Evenings"], note: "Experienced furniture mover with useful evening availability.", categories: ["moving", "repairs"] },
  { name: "Tài Đinh", initials: "TĐ", role: "Local delivery & moving", trust: 85, match: 89, jobs: 37, repeat: "62%", price: "7 USDC/hr", tone: "orange", skills: ["Community verified", "Small van", "Nearby"], note: "Has access to a small van for local furniture and box delivery.", categories: ["moving", "errands"] },
  { name: "An Lương", initials: "AL", role: "Packing assistant", trust: 82, match: 86, jobs: 19, repeat: "55%", price: "5 USDC/hr", tone: "blue", skills: ["ID verified", "Packing", "Budget fit"], note: "Affordable support for packing, unpacking and light moving.", categories: ["moving"] },

  { name: "Nhi Trần", initials: "NT", role: "Neighborhood errand runner", trust: 94, match: 97, jobs: 88, repeat: "80%", price: "5 USDC/hr", tone: "green", skills: ["ID verified", "Fast response", "Top rated"], note: "Top errand match with fast response and an exceptional rehire rate.", categories: ["errands"] },
  { name: "Vy Nguyễn", initials: "VN", role: "Shopping & pickup helper", trust: 92, match: 95, jobs: 67, repeat: "75%", price: "5 USDC/hr", tone: "orange", skills: ["Community verified", "Shopping", "Pickups"], note: "Frequently handles shopping, package pickups and returns nearby.", categories: ["errands"] },
  { name: "Thịnh Lê", initials: "TL", role: "Delivery & queue helper", trust: 89, match: 93, jobs: 49, repeat: "69%", price: "4 USDC/hr", tone: "blue", skills: ["ID verified", "Delivery", "Flexible"], note: "Flexible local helper for delivery, queues and time-sensitive errands.", categories: ["errands"] },
  { name: "Hương Mai", initials: "HM", role: "Plant & home check helper", trust: 91, match: 92, jobs: 44, repeat: "73%", price: "5 USDC/hr", tone: "green", skills: ["ID verified", "Plant care", "Home checks"], note: "Trusted for plant care and short home checks while residents travel.", categories: ["errands", "pet"] },
  { name: "Quỳnh Đào", initials: "QĐ", role: "Senior support helper", trust: 90, match: 91, jobs: 39, repeat: "71%", price: "6 USDC/hr", tone: "orange", skills: ["Community verified", "Patient", "Tech help"], note: "Patient community helper for errands and basic technology assistance.", categories: ["errands"] },
  { name: "Kiên Bùi", initials: "KB", role: "Flexible local helper", trust: 84, match: 88, jobs: 25, repeat: "60%", price: "4 USDC/hr", tone: "blue", skills: ["ID verified", "Evenings", "Budget fit"], note: "Good-value evening availability for simple nearby tasks.", categories: ["errands", "moving"] },

  { name: "Thu Hà", initials: "TH", role: "Senior companionship specialist", trust: 97, match: 98, jobs: 72, repeat: "84%", price: "8 USDC/hr", tone: "green", skills: ["ID verified", "First aid", "Senior support"], note: "Best fit for companionship and daily support, with first-aid training and 72 verified visits.", categories: ["elderly"] },
  { name: "Ngọc Anh", initials: "NA", role: "Patient home companion", trust: 95, match: 96, jobs: 61, repeat: "81%", price: "7 USDC/hr", tone: "orange", skills: ["Community verified", "Patient", "Meal support"], note: "Frequently rehired for conversation, meal preparation and accompanied walks.", categories: ["elderly"] },
  { name: "Bình Lê", initials: "BL", role: "Senior errand companion", trust: 92, match: 94, jobs: 48, repeat: "76%", price: "6 USDC/hr", tone: "blue", skills: ["ID verified", "Appointments", "Errands"], note: "Trusted for accompanying older residents to appointments and completing errands together.", categories: ["elderly", "errands"] },
  { name: "Diễm My", initials: "DM", role: "Daytime senior helper", trust: 90, match: 92, jobs: 36, repeat: "72%", price: "6 USDC/hr", tone: "green", skills: ["ID verified", "Daytime", "Mobility support"], note: "A calm daytime companion experienced with walks and non-medical mobility support.", categories: ["elderly"] },
  { name: "Hoàng Yến", initials: "HY", role: "Home visit companion", trust: 88, match: 90, jobs: 29, repeat: "69%", price: "5 USDC/hr", tone: "orange", skills: ["Community verified", "Home visits", "Tech help"], note: "Reliable nearby helper for friendly visits, phone setup and routine household assistance.", categories: ["elderly", "errands"] },
];

const activity = [
  ["V4 Circle-ready payout", "Completed", "+0.00975 USDC", "verified onchain"],
  ["Shelf assembly · Tower A", "Funded", "18.00 USDC", "4 min ago"],
  ["Home cleaning · Tower C", "Submitted", "14.00 USDC", "11 min ago"],
];

function detectCategory(value: string) {
  const text = value.toLowerCase();
  if (/(elderly|senior|older adult|old people|aged parent|grandparent|người cao tuổi|người già|ông bà|chăm sóc bố mẹ)/.test(text)) return "elderly";
  if (/(clean|dọn|lau|giặt|vệ sinh|organize)/.test(text)) return "cleaning";
  if (/(move|sofa|furniture|chuyển|khiêng|đóng thùng|packing)/.test(text)) return "moving";
  if (/(repair|fix|shelf|mount|install|sửa|lắp|wifi|tv)/.test(text)) return "repairs";
  if (/(dog|cat|pet|chó|mèo|thú cưng|walk)/.test(text)) return "pet";
  if (/(errand|pickup|pick up|delivery|deliver|shopping|grocery|queue|plant|parcel|package|mua hộ|lấy đồ|giao đồ|xếp hàng|tưới cây)/.test(text)) return "errands";
  return "open";
}

const unsafeTaskPattern =
  /(inject|injection|give medicine|medical procedure|wound care|prescription|gas leak|live wire|high voltage|newborn|babysit|childcare|tiêm|thủ thuật y tế|kê đơn|rò rỉ gas|điện cao thế|trông trẻ sơ sinh)/i;

const openTaskConcepts = [
  { pattern: /(plant|garden|water.*flower|tưới cây|chăm cây)/i, helperTerms: ["plant care", "home checks"] },
  { pattern: /(phone|computer|laptop|internet|technology|tech|điện thoại|máy tính)/i, helperTerms: ["tech help", "wi-fi setup", "smart home"] },
  { pattern: /(cook|meal|food prep|prepare dinner|nấu ăn|chuẩn bị bữa)/i, helperTerms: ["meal support", "home helper"] },
  { pattern: /(shop|grocery|buy|return.*item|mua đồ|đi chợ)/i, helperTerms: ["shopping", "pickups", "errand"] },
  { pattern: /(appointment|hospital visit|accompany|đi khám|đưa đi)/i, helperTerms: ["appointments", "senior support", "companion"] },
  { pattern: /(wardrobe|cabinet|desk|ikea|assemble|lắp ráp|tủ|bàn)/i, helperTerms: ["assembly", "furniture", "tools included"] },
  { pattern: /(laundry|iron clothes|wash clothes|giặt|ủi)/i, helperTerms: ["laundry", "home helper"] },
  { pattern: /(home check|check.*house|watch.*home|trông nhà)/i, helperTerms: ["home checks", "home visits"] },
];

const taskStopWords = new Set([
  "the", "and", "for", "with", "need", "help", "looking", "after", "please", "someone",
  "tomorrow", "today", "this", "that", "from", "hour", "hours", "local", "my", "our",
  "tôi", "cần", "giúp", "với", "cho", "một", "người", "ngày", "mai",
]);

function scoreOpenTask(task: string, helper: Helper) {
  const query = task.toLowerCase();
  const profile = `${helper.role} ${helper.skills.join(" ")} ${helper.note}`.toLowerCase();
  const tokens = query.match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length > 2 && !taskStopWords.has(token)) ?? [];
  const lexicalHits = [...new Set(tokens)].filter((token) => profile.includes(token)).length;
  const conceptHits = openTaskConcepts.reduce((score, concept) => {
    if (!concept.pattern.test(query)) return score;
    return score + concept.helperTerms.filter((term) => profile.includes(term)).length;
  }, 0);
  return lexicalHits * 3 + conceptHits * 5;
}

function suggestedBudgetFor(category: string) {
  if (category === "cleaning") return "15";
  if (category === "moving") return "20";
  if (category === "repairs") return "15";
  if (category === "pet") return "7";
  if (category === "elderly") return "9";
  if (category === "errands") return "7";
  return "10";
}

export default function Home() {
  const [task, setTask] = useState(
    "Walk my golden retriever tomorrow from 6-7 PM. Budget up to 8 USDC.",
  );
  const [showMatches, setShowMatches] = useState(false);
  const [selected, setSelected] = useState<Helper | null>(null);
  const [wallet, setWallet] = useState("");
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const [jobStage, setJobStage] = useState<JobStage>("review");
  const [chosenHelper, setChosenHelper] = useState<Helper | null>(null);
  const [role, setRole] = useState<UserRole>("resident");
  const [liveStage, setLiveStage] = useState<LiveStage>("idle");
  const [liveJobId, setLiveJobId] = useState<bigint | null>(null);
  const [liveProvider, setLiveProvider] = useState("");
  const [liveBusy, setLiveBusy] = useState("");
  const [liveError, setLiveError] = useState("");
  const [liveTxs, setLiveTxs] = useState<Array<{ label: string; hash: string }>>([]);
  const [budgetUsdc, setBudgetUsdc] = useState("7");
  const [liveJobs, setLiveJobs] = useState<LiveJobRecord[]>([]);
  const [liveApplications, setLiveApplications] = useState<LiveApplication[]>([]);
  const [boardBusy, setBoardBusy] = useState("");
  const [walletMenu, setWalletMenu] = useState(false);
  const [circleModal, setCircleModal] = useState(false);
  const [externalWalletModal, setExternalWalletModal] = useState(false);
  const [walletKind, setWalletKind] = useState<"external" | "circle" | "">("");
  const [circleBalance, setCircleBalance] = useState<string | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceRecord, setEvidenceRecord] = useState<EvidenceRecord | null>(null);
  const externalProviderRef = useRef<Eip1193Provider | null>(null);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>(".scroll-reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle("is-visible", entry.isIntersecting);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [showMatches, task]);

  useEffect(() => {
    const appKit = reownAppKit;
    if (!appKit) return;
    return appKit.subscribeProviders((providers) => {
      const provider = providers.eip155 as Eip1193Provider | undefined;
      const account = appKit.getAccount("eip155");
      if (!provider || !account || !account.isConnected || !account.address) return;
      externalProviderRef.current = provider;
      setWallet(account.address);
      setWalletKind("external");
      setCircleBalance(null);
      setExternalWalletModal(false);
      setNotice("WalletConnect wallet connected on Arc Testnet.");
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const session = JSON.parse(window.localStorage.getItem(LIVE_SESSION_KEY) ?? "null") as {
          jobId?: string;
          stage?: LiveStage;
          budget?: string;
          provider?: string;
          applications?: LiveApplication[];
        } | null;
        const storedApplications = JSON.parse(
          window.localStorage.getItem(LIVE_APPLICATIONS_KEY) ?? "[]",
        ) as LiveApplication[];
        if (session?.jobId) setLiveJobId(BigInt(session.jobId));
        if (session?.stage) {
          setLiveStage(session.stage);
          if (session.stage === "funded") {
            setJobStage("open");
            setShowMatches(true);
          }
          if (["assigned", "submitted", "completed"].includes(session.stage)) {
            setJobStage("assigned");
            setShowMatches(true);
          }
        }
        if (session?.budget) setBudgetUsdc(session.budget);
        if (session?.provider) setLiveProvider(session.provider);
        setLiveApplications(storedApplications);
      } catch {
        window.localStorage.removeItem(LIVE_SESSION_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify({
      jobId: liveJobId?.toString() ?? null,
      stage: liveStage,
      budget: budgetUsdc,
      provider: liveProvider,
    }));
  }, [budgetUsdc, liveJobId, liveProvider, liveStage]);

  useEffect(() => {
    window.localStorage.setItem(LIVE_APPLICATIONS_KEY, JSON.stringify(liveApplications));
  }, [liveApplications]);

  const taskCategory = useMemo(() => detectCategory(task), [task]);
  const budgetUnits = useMemo(() => {
    try {
      const parsed = parseUnits(budgetUsdc || "0", 6);
      return parsed >= 10_000n && parsed <= 100_000_000n ? parsed : null;
    } catch {
      return null;
    }
  }, [budgetUsdc]);

  const payoutPreview = useMemo(() => {
    if (budgetUnits === null) return null;
    const fee = budgetUnits * 250n / 10_000n;
    const provider = budgetUnits - fee;
    return {
      provider: Number(provider) / 1_000_000,
      fee: Number(fee) / 1_000_000,
    };
  }, [budgetUnits]);

  const taskBlocked = useMemo(() => unsafeTaskPattern.test(task), [task]);
  const summary = useMemo(() => {
    if (taskBlocked) return ["Safety review", "Licensed help", "Not matched"];
    if (taskCategory === "elderly") return ["Senior companionship", "Flexible visit", "6-12 USDC"];
    if (taskCategory === "cleaning") return ["Home cleaning", "2-3 hours", "12-18 USDC"];
    if (taskCategory === "moving") return ["Moving help", "2 helpers", "16-24 USDC"];
    if (taskCategory === "repairs") return ["Small repair", "1-2 hours", "10-20 USDC"];
    if (taskCategory === "pet") return ["Pet care", "1 hour", "5-8 USDC"];
    if (taskCategory === "errands") return ["Local errand", "1-2 hours", "4-10 USDC"];
    return ["Custom request", "Skills-based", "After matching"];
  }, [taskBlocked, taskCategory]);

  const matchedHelpers = useMemo(() => {
    if (taskBlocked) return [];
    if (taskCategory === "open") {
      return helpers
        .map((helper) => ({ helper, relevance: scoreOpenTask(task, helper) }))
        .filter(({ relevance }) => relevance >= 5)
        .sort((a, b) => b.relevance - a.relevance || b.helper.trust - a.helper.trust)
        .slice(0, 3)
        .map(({ helper, relevance }) => ({
          ...helper,
          match: Math.min(96, 70 + relevance + Math.round(helper.trust / 10)),
          note: `Open-task match · Relevant profile skills found in: ${helper.skills.join(", ")}.`,
        }));
    }
    return helpers
      .filter((helper) => helper.categories.includes(taskCategory))
      .map((helper) => {
        const primaryBonus = helper.categories[0] === taskCategory ? 2 : -1;
        const reliabilityBonus = helper.repeat.startsWith("8") ? 1 : 0;
        return { ...helper, match: Math.min(99, helper.match + primaryBonus + reliabilityBonus) };
      })
      .sort((a, b) => b.match - a.match || b.trust - a.trust)
      .slice(0, 3);
  }, [task, taskBlocked, taskCategory]);

  const currentApplications = useMemo(
    () => liveApplications.filter((application) => application.jobId === liveJobId?.toString()),
    [liveApplications, liveJobId],
  );

  async function connectWallet(selectedProvider?: Eip1193Provider, providerName = "Wallet") {
    const eth = selectedProvider ?? (window as Window & { ethereum?: EthereumProvider }).ethereum;
    if (!eth) {
      setNotice("Install an EVM wallet to connect to Arc Testnet.");
      return;
    }
    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x4CEF52",
            chainName: "Arc Testnet",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: ["https://rpc.testnet.arc.network"],
            blockExplorerUrls: ["https://testnet.arcscan.app"],
          },
        ],
      });
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      externalProviderRef.current = eth;
      setWallet(accounts[0]);
      setWalletKind("external");
      setCircleBalance(null);
      setExternalWalletModal(false);
      setNotice(`${providerName} connected to Arc Testnet.`);
    } catch {
      setNotice("Wallet connection was cancelled.");
    }
  }

  function injectedProvider() {
    return externalProviderRef.current ?? (window as Window & { ethereum?: EthereumProvider }).ethereum;
  }

  async function arcPublicRpc(method: string, params: unknown[]) {
    const response = await fetch("https://rpc.blockdaemon.testnet.arc.network", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) throw new Error("Arc public RPC is temporarily unavailable.");
    const payload = await response.json() as { result?: unknown; error?: { message?: string } };
    if (payload.error) throw new Error(payload.error.message || "Arc RPC request failed.");
    return payload.result;
  }

  async function disconnectWallet() {
    const eth = injectedProvider();
    try {
      await eth?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Some injected wallets do not implement permission revocation.
    }
    setWallet("");
    setWalletKind("");
    setCircleBalance(null);
    clearCircleWalletSession();
    externalProviderRef.current = null;
    setWalletMenu(false);
    setNotice("Wallet disconnected from LocalMate.");
  }

  async function copyWalletAddress() {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet);
      setNotice("Wallet address copied.");
    } catch {
      setNotice(`Wallet address: ${wallet}`);
    }
  }

  const connectCircleWallet = useCallback(
    (connectedWallet: { id: string; address: string; blockchain: string }, balance: string | null) => {
      window.sessionStorage.removeItem("localmate-circle-login-pending");
      setWallet(connectedWallet.address);
      setWalletKind("circle");
      setCircleBalance(balance);
      setNotice("Circle Wallet connected on Arc Testnet.");
    },
    [],
  );

  const closeCircleModal = useCallback(() => {
    setCircleModal(false);
  }, []);

  const openExternalWallet = useCallback(() => {
    if (reownAppKit) {
      void reownAppKit.open({ view: "Connect" });
    } else {
      setExternalWalletModal(true);
    }
  }, []);

  useEffect(() => {
    if (window.sessionStorage.getItem("localmate-circle-login-pending") === "true") {
      const timer = window.setTimeout(() => {
        setCircleModal(true);
        setNotice("Finishing your Circle Wallet sign-in...");
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  async function ensureArcNetwork() {
    if (walletKind === "circle") return;
    const eth = injectedProvider();
    if (!eth) throw new Error("Install an EVM wallet before using Live Arc mode.");
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x4CEF52" }] });
    } catch {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x4CEF52",
          chainName: "Arc Testnet",
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: ["https://rpc.testnet.arc.network"],
          blockExplorerUrls: ["https://testnet.arcscan.app"],
        }],
      });
    }
  }

  async function activeAccount() {
    if (walletKind === "circle") {
      const session = getCircleWalletSession();
      if (!session || !wallet) throw new Error("Reconnect your Circle Wallet to continue.");
      return wallet;
    }
    const eth = injectedProvider();
    if (!eth) throw new Error("Install an EVM wallet before using Live Arc mode.");
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts[0]) throw new Error("No wallet account is connected.");
    setWallet(accounts[0]);
    return accounts[0];
  }

  async function waitForWalletReceipt(hash: string) {
    const eth = injectedProvider();
    if (!eth) throw new Error("Wallet disconnected.");
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const receipt = await eth.request({ method: "eth_getTransactionReceipt", params: [hash] }) as { status?: string } | null;
      if (receipt) {
        if (receipt.status !== "0x1") throw new Error("The Arc transaction reverted.");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error("Transaction confirmation timed out. Check Arcscan before retrying.");
  }

  async function waitForPublicReceipt(hash: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const receipt = await arcPublicRpc("eth_getTransactionReceipt", [hash]) as { status?: string } | null;
      if (receipt) {
        if (receipt.status !== "0x1") throw new Error("The Circle Wallet transaction reverted on Arc.");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error("Circle transaction confirmation timed out. Check Arcscan before retrying.");
  }

  async function sendCircleTransaction(to: string, data: string, label: string) {
    const session = getCircleWalletSession();
    if (!session) throw new Error("Reconnect your Circle Wallet to authorize this transaction.");
    const challenge = await circleAction({
      action: "createContractExecution",
      userToken: session.userToken,
      walletId: session.walletId,
      contractAddress: to,
      callData: data,
      refId: `LocalMate: ${label}`,
    });
    if (!challenge.challengeId) throw new Error("Circle did not create a transaction challenge.");
    await executeCircleChallenge(session.sdk, challenge.challengeId);

    const challengeRecord = await circleAction({
      action: "getChallenge",
      userToken: session.userToken,
      challengeId: challenge.challengeId,
    });
    const transactionId = challengeRecord.challenge?.correlationIds?.[0];
    if (!transactionId) throw new Error("Circle approved the action but did not return a transaction ID.");

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const transactionData = await circleAction({
        action: "getTransaction",
        userToken: session.userToken,
        transactionId,
      });
      const transaction = transactionData.transaction;
      if (["FAILED", "DENIED", "CANCELLED"].includes(transaction?.state)) {
        throw new Error(`Circle transaction ${String(transaction.state).toLowerCase()}.`);
      }
      if (transaction?.txHash) {
        const hash = transaction.txHash as string;
        setLiveTxs((items) => [...items, { label: `${label} · Circle`, hash }]);
        await waitForPublicReceipt(hash);
        return hash;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error("Circle accepted the transaction but its Arc hash is still pending.");
  }

  async function sendLiveTransaction(to: string, data: string, label: string) {
    if (walletKind === "circle") {
      return sendCircleTransaction(to, data, label);
    }
    const eth = injectedProvider();
    await ensureArcNetwork();
    const from = await activeAccount();
    if (!eth) throw new Error("Wallet disconnected.");
    const hash = await eth.request({
      method: "eth_sendTransaction",
      params: [{ from, to, data }],
    }) as string;
    setLiveTxs((items) => [...items, { label, hash }]);
    await waitForWalletReceipt(hash);
    return hash;
  }

  async function refreshLiveJobBoard() {
    setLiveError("");
    setBoardBusy("Reading funded jobs from Arc...");
    try {
      const nextJobData = encodeFunctionData({ abi: v3Abi, functionName: "nextJobId" });
      const rawNextJobId = await arcPublicRpc(
        "eth_call",
        [{ to: deploymentV3.contractAddress, data: nextJobData }, "latest"],
      ) as `0x${string}`;
      const nextJobId = decodeFunctionResult({
        abi: v3Abi,
        functionName: "nextJobId",
        data: rawNextJobId,
      });
      const firstJobId = nextJobId > 30n ? nextJobId - 30n : 1n;
      const metadata = JSON.parse(
        window.localStorage.getItem(LIVE_JOBS_KEY) ?? "{}",
      ) as Record<string, { task?: string }>;
      const jobs: LiveJobRecord[] = [];

      for (let jobId = firstJobId; jobId < nextJobId; jobId += 1n) {
        const data = encodeFunctionData({ abi: v3Abi, functionName: "jobs", args: [jobId] });
        const raw = await arcPublicRpc(
          "eth_call",
          [{ to: deploymentV3.contractAddress, data }, "latest"],
        ) as `0x${string}`;
        const decoded = decodeFunctionResult({
          abi: v3Abi,
          functionName: "jobs",
          data: raw,
        });
        if (decoded[6] === 1 && decoded[1] === "0x0000000000000000000000000000000000000000") {
          jobs.push({
            id: jobId,
            client: decoded[0],
            provider: decoded[1],
            evaluator: decoded[2],
            budget: decoded[3],
            expiresAt: decoded[4],
            status: decoded[6],
            requirementsHash: decoded[7],
            task: metadata[jobId.toString()]?.task,
          });
        }
      }
      setLiveJobs(jobs);
      const ownedJob = wallet
        ? jobs.find((job) => job.client.toLowerCase() === wallet.toLowerCase())
        : undefined;
      if (ownedJob) {
        setLiveJobId(ownedJob.id);
        setLiveStage("funded");
        setBudgetUsdc(formatUnits(ownedJob.budget, 6));
        if (role === "resident") {
          setJobStage("open");
          setShowMatches(true);
          window.setTimeout(() => document.getElementById("matches")?.scrollIntoView({ behavior: "smooth" }), 80);
        }
      }
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Could not read the Arc job board.");
    } finally {
      setBoardBusy("");
    }
  }

  async function applyToLiveJob(job: LiveJobRecord) {
    setLiveError("");
    setBoardBusy(`Signing application for job #${job.id}...`);
    try {
      await ensureArcNetwork();
      const account = await activeAccount();
      if (account.toLowerCase() === job.client.toLowerCase()) {
        throw new Error("The client wallet cannot apply to its own job. Switch to the helper wallet.");
      }
      const digestData = encodeFunctionData({
        abi: v3Abi,
        functionName: "applicationDigest",
        args: [job.id, account as `0x${string}`],
      });
      const rawDigest = await arcPublicRpc(
        "eth_call",
        [{ to: deploymentV3.contractAddress, data: digestData }, "latest"],
      ) as `0x${string}`;
      const digest = decodeFunctionResult({
        abi: v3Abi,
        functionName: "applicationDigest",
        data: rawDigest,
      });
      let signature: string;
      if (walletKind === "circle") {
        const session = getCircleWalletSession();
        if (!session) throw new Error("Reconnect your Circle Wallet to sign the application.");
        const signChallenge = await circleAction({
          action: "signMessage",
          userToken: session.userToken,
          walletId: session.walletId,
          message: digest,
          memo: `Apply to LocalMate job #${job.id}`,
        });
        const signResult = await executeCircleChallenge(session.sdk, signChallenge.challengeId);
        signature = "data" in signResult && signResult.data && "signature" in signResult.data
          ? signResult.data.signature
          : "";
        if (!signature) throw new Error("Circle did not return the application signature.");
      } else {
        const eth = injectedProvider();
        if (!eth) throw new Error("Wallet disconnected.");
        signature = await eth.request({
          method: "personal_sign",
          params: [digest, account],
        }) as string;
      }
      const application: LiveApplication = {
        jobId: job.id.toString(),
        provider: account,
        signature,
        applicationHash: keccak256(signature as `0x${string}`),
        appliedAt: new Date().toISOString(),
      };
      setLiveApplications((items) => [
        ...items.filter((item) => !(item.jobId === application.jobId && item.provider.toLowerCase() === account.toLowerCase())),
        application,
      ]);
      setNotice(`Application for live job #${job.id} signed by ${account.slice(0, 6)}...${account.slice(-4)}.`);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Application signature failed.");
    } finally {
      setBoardBusy("");
    }
  }

  async function createAndFundLiveJob() {
    if (taskBlocked) return;
    if (budgetUnits === null) {
      setLiveError("Enter a budget from 0.01 to 100 USDC with no more than 6 decimals.");
      return;
    }
    setLiveError("");
    try {
      await ensureArcNetwork();
      const account = await activeAccount();

      setLiveBusy("Creating job on Arc...");
      const nextJobData = encodeFunctionData({ abi: v3Abi, functionName: "nextJobId" });
      const rawJobId = await arcPublicRpc(
        "eth_call",
        [{ to: deploymentV3.contractAddress, data: nextJobData }, "latest"],
      ) as `0x${string}`;
      const jobId = decodeFunctionResult({ abi: v3Abi, functionName: "nextJobId", data: rawJobId });
      const latestBlock = await arcPublicRpc(
        "eth_getBlockByNumber",
        ["latest", false],
      ) as { timestamp: string };
      const createData = encodeFunctionData({
        abi: v3Abi,
        functionName: "createJob",
        args: [
          account as `0x${string}`,
          budgetUnits,
          BigInt(latestBlock.timestamp) + 86_400n,
          keccak256(toBytes(task)),
        ],
      });
      await sendLiveTransaction(deploymentV3.contractAddress, createData, "Create job");

      setLiveBusy(`Approving ${budgetUsdc} USDC...`);
      const approveData = encodeFunctionData({
        abi: usdcAbi,
        functionName: "approve",
        args: [deploymentV3.contractAddress as `0x${string}`, budgetUnits],
      });
      await sendLiveTransaction("0x3600000000000000000000000000000000000000", approveData, "Approve USDC");

      setLiveBusy("Funding escrow...");
      const fundData = encodeFunctionData({ abi: v3Abi, functionName: "fund", args: [jobId] });
      await sendLiveTransaction(deploymentV3.contractAddress, fundData, "Fund escrow");
      setLiveJobId(jobId);
      setLiveStage("funded");
      setJobStage("open");
      const metadata = JSON.parse(
        window.localStorage.getItem(LIVE_JOBS_KEY) ?? "{}",
      ) as Record<string, { task?: string; budget?: string }>;
      metadata[jobId.toString()] = { task, budget: budgetUsdc };
      window.localStorage.setItem(LIVE_JOBS_KEY, JSON.stringify(metadata));
      setNotice(`Live Arc job #${jobId} is funded with ${budgetUsdc} USDC.`);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Live transaction failed.");
    } finally {
      setLiveBusy("");
    }
  }

  async function assignLiveProvider(application?: LiveApplication) {
    const providerAddress = application?.provider ?? liveProvider;
    const applicationHash = application?.applicationHash;
    if (liveJobId === null || !/^0x[a-fA-F0-9]{40}$/.test(providerAddress) || !applicationHash) {
      setLiveError("Select a wallet-signed application before assigning a provider.");
      return;
    }
    setLiveError("");
    setLiveBusy("Assigning selected applicant...");
    try {
      const data = encodeFunctionData({
        abi: v3Abi,
        functionName: "assignProvider",
        args: [
          liveJobId,
          providerAddress as `0x${string}`,
          application.signature as `0x${string}`,
        ],
      });
      await sendLiveTransaction(deploymentV3.contractAddress, data, "Assign provider");
      setLiveProvider(providerAddress);
      setLiveStage("assigned");
      setJobStage("assigned");
      setChosenHelper(chosenHelper ?? matchedHelpers[0] ?? null);
      setSelected(null);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Provider assignment failed.");
    } finally {
      setLiveBusy("");
    }
  }

  async function cancelAndRefundLiveJob() {
    if (liveJobId === null) return;
    setLiveError("");
    setLiveBusy("Cancelling job and returning escrow...");
    try {
      const data = encodeFunctionData({
        abi: v3Abi,
        functionName: "cancelUnassigned",
        args: [liveJobId],
      });
      await sendLiveTransaction(deploymentV3.contractAddress, data, "Cancel and refund");
      setLiveStage("cancelled");
      setJobStage("review");
      setShowMatches(false);
      setNotice(`Live job #${liveJobId} cancelled. Escrow was returned to the client wallet.`);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Refund failed. Use the original client wallet.");
    } finally {
      setLiveBusy("");
    }
  }

  async function submitLiveWork() {
    if (liveJobId === null || !evidenceFile) return;
    setLiveError("");
    setLiveBusy("Uploading and hashing evidence...");
    try {
      const provider = await activeAccount();
      const body = new FormData();
      body.append("file", evidenceFile);
      body.append("jobId", liveJobId.toString());
      body.append("provider", provider);
      const response = await fetch("/api/evidence", { method: "POST", body });
      const record = await response.json() as EvidenceRecord & { error?: string };
      if (!response.ok) throw new Error(record.error || "Evidence upload failed.");
      setLiveBusy("Anchoring evidence hash on Arc...");
      const data = encodeFunctionData({
        abi: v3Abi,
        functionName: "submitEvidence",
        args: [
          liveJobId,
          record.evidenceHash as `0x${string}`,
          keccak256(toBytes(record.uri)),
        ],
      });
      await sendLiveTransaction(deploymentV3.contractAddress, data, "Anchor evidence");
      setEvidenceRecord(record);
      setLiveStage("submitted");
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Submission failed. Switch to the assigned provider wallet.");
    } finally {
      setLiveBusy("");
    }
  }

  async function rejectLiveEvidence() {
    if (liveJobId === null) return;
    setLiveError("");
    setLiveBusy("Rejecting evidence and returning escrow...");
    try {
      const data = encodeFunctionData({
        abi: v3Abi,
        functionName: "reject",
        args: [liveJobId, keccak256(toBytes("Resident rejected the submitted evidence"))],
      });
      await sendLiveTransaction(deploymentV3.contractAddress, data, "Reject and refund");
      setLiveStage("rejected");
      setNotice(`Live job #${liveJobId} rejected. Escrow was returned to the resident.`);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Rejection failed. Use the client/evaluator wallet.");
    } finally {
      setLiveBusy("");
    }
  }

  async function disputeLiveJob() {
    if (liveJobId === null) return;
    setLiveError("");
    setLiveBusy("Opening an onchain dispute...");
    try {
      const data = encodeFunctionData({
        abi: v3Abi,
        functionName: "raiseDispute",
        args: [liveJobId, keccak256(toBytes("The parties requested human review"))],
      });
      await sendLiveTransaction(deploymentV3.contractAddress, data, "Raise dispute");
      setLiveStage("disputed");
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Dispute failed. Use the resident or assigned provider wallet.");
    } finally {
      setLiveBusy("");
    }
  }

  async function resolveLiveDispute(providerShareBps: number) {
    if (liveJobId === null) return;
    setLiveError("");
    setLiveBusy("Resolving dispute on Arc...");
    try {
      const data = encodeFunctionData({
        abi: v3Abi,
        functionName: "resolveDispute",
        args: [liveJobId, providerShareBps],
      });
      await sendLiveTransaction(deploymentV3.contractAddress, data, "Resolve dispute");
      setLiveStage("completed");
      setNotice(`Live job #${liveJobId} dispute resolved on Arc.`);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Resolution failed. Use the evaluator wallet.");
    } finally {
      setLiveBusy("");
    }
  }

  async function completeLiveJob() {
    if (liveJobId === null) return;
    setLiveError("");
    setLiveBusy("Approving payout...");
    try {
      const data = encodeFunctionData({ abi: v3Abi, functionName: "complete", args: [liveJobId] });
      await sendLiveTransaction(deploymentV3.contractAddress, data, "Complete and payout");
      setLiveStage("completed");
      setNotice(`Live job #${liveJobId} completed and paid on Arc.`);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Payout failed. Switch back to the client/evaluator wallet.");
    } finally {
      setLiveBusy("");
    }
  }

  function findMatches() {
    setJobStage("review");
    setChosenHelper(null);
    setShowMatches(true);
    window.setTimeout(
      () => document.getElementById("matches")?.scrollIntoView({ behavior: "smooth" }),
      80,
    );
  }

  function postJob() {
    if (taskBlocked) return;
    void createAndFundLiveJob();
  }

  return (
    <main>
      <header className="nav-shell">
        <nav className="nav wrap" aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="LocalMate home">
            <span className="brand-mark">L</span>
            <span>LocalMate</span>
          </a>
          <button className="menu-toggle" onClick={() => setMenu(!menu)} aria-label="Toggle menu">
            {menu ? "×" : "☰"}
          </button>
          <div className={`nav-links ${menu ? "open" : ""}`}>
            <a href="#services">Explore</a>
            <a href="#trust">Trust</a>
            <a href="#arc">Built on Arc</a>
            <a href="#work">How it works</a>
          </div>
          <div className="nav-actions">
            <div className="nav-role-switch" aria-label="Switch LocalMate role">
              <button className={role === "resident" ? "active" : ""} onClick={() => {
                setRole("resident");
                window.setTimeout(() => void refreshLiveJobBoard(), 80);
              }}>Resident</button>
              <button className={role === "helper" ? "active" : ""} onClick={() => {
                setRole("helper");
                window.setTimeout(() => {
                  document.getElementById("job-board")?.scrollIntoView({ behavior: "smooth" });
                  void refreshLiveJobBoard();
                }, 80);
              }}>Helper</button>
            </div>
            <div className="wallet-control">
              <button className="wallet-button" onClick={() => wallet ? setWalletMenu(!walletMenu) : setCircleModal(true)}>
                <span className="status-dot" />
                {wallet ? `${wallet.slice(0, 5)}…${wallet.slice(-4)}` : "Connect wallet"}
                {wallet && <b className="wallet-caret">⌄</b>}
              </button>
              {wallet && walletMenu && (
                <div className="wallet-menu">
                  <span>
                    <small>{walletKind === "circle" ? "Circle Wallet · Arc Testnet" : "Connected on Arc"}</small>
                    <code title={wallet}>{wallet.slice(0, 8)}...{wallet.slice(-6)}</code>
                    {walletKind === "circle" && (
                      <strong className="wallet-balance">{circleBalance ?? "0"} USDC</strong>
                    )}
                  </span>
                  <button className="copy-address" onClick={() => void copyWalletAddress()}>
                    Copy full address
                  </button>
                  <button onClick={() => setCircleModal(true)}>Switch wallet</button>
                  <button className="disconnect" onClick={() => void disconnectWallet()}>Disconnect</button>
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      <CircleWalletModal
        open={circleModal}
        onClose={closeCircleModal}
        onExternalWallet={openExternalWallet}
        onConnected={connectCircleWallet}
      />
      <ExternalWalletModal
        open={externalWalletModal}
        onClose={() => setExternalWalletModal(false)}
        onSelect={(provider, name) => void connectWallet(provider, name)}
      />

      <section id="top" className="hero">
        <div className="hero-image" aria-label="A resident meets a trusted local dog walker" />
        <div className="hero-shade" />
        <div className="wrap hero-grid">
          <div className="hero-copy reveal">
            <div className="eyebrow"><span>AI-powered local help</span><i /> Built on Arc</div>
            <h1>Life gets busy.<br /><em>Your neighborhood can help.</em></h1>
            <p>
              Describe what you need. Your AI agent prepares the job, locks payment
              in USDC, and ranks the trusted neighbors who choose to apply.
            </p>
            <div className="task-composer">
              <div className="composer-label">
                <span className="spark">✦</span>
                <span>What can we help with?</span>
              </div>
              <textarea
                value={task}
                onChange={(event) => {
                  const nextTask = event.target.value;
                  const nextCategory = detectCategory(nextTask);
                  if (nextCategory !== taskCategory) setBudgetUsdc(suggestedBudgetFor(nextCategory));
                  setTask(nextTask);
                }}
                aria-label="Describe your task"
              />
              <div className="composer-bottom">
                <span>Sunrise Riverside · Tomorrow</span>
                <button onClick={findMatches}>Start live job <b>→</b></button>
              </div>
            </div>
            <div className="social-proof">
              <div className="avatar-stack"><span>MT</span><span>LP</span><span>QN</span><span>+9</span></div>
              <p><strong>12 trusted helpers</strong><br />active in your community</p>
            </div>
          </div>
          <div className="floating-card">
            <span className="live-pill"><i /> Agent working</span>
            <p className="mini-label">LOCALMATE AGENT</p>
            <h3>Post once.<br />Choose from willing applicants.</h3>
            <div className="agent-row"><span>✓</span><div><b>Job brief prepared</b><small>Skills, budget & safety checks</small></div></div>
            <div className="agent-row"><span>✓</span><div><b>USDC escrow ready</b><small>Applicants see verified funding</small></div></div>
            <div className="agent-row active"><span>✦</span><div><b>AI ranking ready</b><small>Only applicants are compared</small></div></div>
            <div className="agent-footer">
              <span>Matching engine · off-chain</span>
              <a href="#arc">See what is live on Arc ↘</a>
            </div>
          </div>
        </div>
      </section>

      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}

      {role === "helper" && (
        <section id="job-board" className="helper-board section">
          <div className="wrap">
            <div className="helper-board-head">
              <div>
                <p className="kicker">LIVE JOB BOARD ON ARC</p>
                <h2>Funded work, ready for applicants.</h2>
                <p>Every listing below is read from LocalMateJobsV4. Apply with an EOA or Circle smart-wallet signature.</p>
              </div>
              <div>
                <button className="wallet-button" onClick={() => setCircleModal(true)}>
                  <span className="status-dot" />
                  {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Connect only to apply"}
                </button>
                <button className="refresh-board" onClick={() => void refreshLiveJobBoard()} disabled={Boolean(boardBusy)}>
                  {boardBusy || "Refresh from Arc"}
                </button>
              </div>
            </div>

            {liveJobs.length > 0 ? (
              <div className="live-job-grid">
                {liveJobs.map((job) => {
                  const application = liveApplications.find(
                    (item) => item.jobId === job.id.toString() && item.provider.toLowerCase() === wallet.toLowerCase(),
                  );
                  const ownJob = Boolean(wallet) && job.client.toLowerCase() === wallet.toLowerCase();
                  return (
                    <article className="live-job-card" key={job.id.toString()}>
                      <div className="live-job-title">
                        <span>JOB #{job.id.toString()}</span>
                        <i><b className="status-dot" /> Funded on Arc</i>
                      </div>
                      <h3>{job.task || "Private neighborhood service request"}</h3>
                      <p>{job.task ? "Full brief available in this LocalMate session." : `Requirements anchored as ${job.requirementsHash.slice(0, 12)}...`}</p>
                      <div className="live-job-facts">
                        <span><small>Escrow</small><b>{formatUnits(job.budget, 6)} USDC</b></span>
                        <span><small>Expires</small><b>{new Date(Number(job.expiresAt) * 1000).toLocaleString()}</b></span>
                        <span><small>Client</small><b>{job.client.slice(0, 6)}...{job.client.slice(-4)}</b></span>
                      </div>
                      <button onClick={() => void applyToLiveJob(job)} disabled={Boolean(boardBusy) || Boolean(application) || ownJob}>
                        {ownJob ? "Your job - cannot apply" : application ? "Application signed ✓" : "Apply with connected wallet"} <span>→</span>
                      </button>
                      {application && <small className="signature-proof">Signature hash: {application.applicationHash.slice(0, 14)}...</small>}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-board">
                <span>⌁</span>
                <h3>{boardBusy ? "Reading Arc Testnet..." : "No funded, unassigned jobs loaded."}</h3>
                <p>Connect the helper wallet and refresh. Job #2 will appear if it is still funded and unassigned.</p>
              </div>
            )}
            {liveError && <p className="live-error">{liveError}</p>}
          </div>
        </section>
      )}

      <section id="services" className="services wrap section">
        <div className="section-heading scroll-reveal">
          <div><p className="kicker">HELP, RIGHT WHERE YOU LIVE</p><h2>One neighborhood.<br />A hundred ways to help.</h2></div>
          <p>From the everyday to the unexpected, find someone nearby with the right skills and a track record you can verify.</p>
        </div>
        <div className="service-grid">
          {services.map((service) => (
            <button key={service.name} className={`service-card ${service.color} scroll-reveal reveal-delay-${(services.indexOf(service) % 3) + 1}`} onClick={() => {
              const nextTask = `I need help with ${service.name.toLowerCase()} tomorrow.`;
              setTask(nextTask);
              setBudgetUsdc(suggestedBudgetFor(detectCategory(nextTask)));
              setShowMatches(false);
              setJobStage("review");
              setChosenHelper(null);
              document.getElementById("top")?.scrollIntoView({ behavior: "smooth" });
            }}>
              <span className="service-icon">{service.icon}</span>
              <span><b>{service.name}</b><small>{service.sub}</small></span>
              <i>↗</i>
            </button>
          ))}
        </div>
      </section>

      <section id="matches" className={`matches-section ${showMatches ? "visible" : ""}`}>
        <div className="wrap">
          <div className="match-top scroll-reveal">
            <div>
              <p className="kicker">
                {jobStage === "review" ? "AI JOB PREPARATION" : jobStage === "open" ? "VERIFIED APPLICANTS" : "HELPER CONFIRMED"}
              </p>
              <h2>
                {jobStage === "review"
                  ? "Review before you post."
                  : jobStage === "open"
                    ? "Choose from people who applied."
                    : "Your job is ready to begin."}
              </h2>
            </div>
            <div className="parsed-task">
              <span><small>Task</small>{summary[0]}</span>
              <span><small>Need</small>{summary[1]}</span>
              <span><small>Suggested</small>{summary[2]}</span>
            </div>
          </div>

          {jobStage === "review" && !taskBlocked && (
            <div className="job-review-card match-entry">
              <div className="job-review-main">
                <span className="live-pill"><i /> Ready to post</span>
                <h3>{summary[0]}</h3>
                <p>{task}</p>
                <div className="job-facts">
                  <span><small>Location</small><b>Sunrise Riverside</b></span>
                  <span><small>Timing</small><b>{summary[1]}</b></span>
                  <span className="budget-fact">
                    <small>Your budget</small>
                    <label>
                      <input
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={budgetUsdc}
                        onChange={(event) => setBudgetUsdc(event.target.value)}
                        aria-label="Job budget in USDC"
                      />
                      <em>USDC</em>
                    </label>
                  </span>
                </div>
                <p className="budget-guidance">
                  Suggested range: <b>{summary[2]}</b>. You decide the final escrow amount.
                </p>
              </div>
              <div className="job-review-action">
                <p className="kicker">LIVE ARC TESTNET</p>
                <h4>Create and fund a real V4 job.</h4>
                <ul>
                  <li><span>✓</span> AI safety check passed</li>
                  <li><span>✓</span> Applicants opt in themselves</li>
                  <li><span>✓</span> You choose after applications arrive</li>
                </ul>
                <button onClick={postJob} disabled={Boolean(liveBusy) || budgetUnits === null}>
                  {liveBusy || `Create + approve + fund ${budgetUsdc || "0"} USDC`} <span>→</span>
                </button>
                <small>
                  Requires three wallet confirmations on Arc Testnet.
                </small>
                {!wallet && <button className="connect-inline" onClick={() => setCircleModal(true)}>Connect Arc wallet first</button>}
                {payoutPreview && (
                  <p className="payout-preview">
                    Provider receives <b>{payoutPreview.provider.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} USDC</b>
                    <span>Platform fee {payoutPreview.fee.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} USDC</span>
                  </p>
                )}
                {liveError && <p className="live-error">{liveError}</p>}
              </div>
            </div>
          )}

          {jobStage === "open" && (
            <>
              <div className="application-status">
                <div><span className="status-dot" /><b>Job open and funded</b></div>
                <p>{currentApplications.length} wallet-signed applicants · Ranked by the LocalMate matching engine</p>
              </div>
              <div className="live-control-panel">
                <div>
                  <p className="kicker">LIVE JOB #{liveJobId?.toString()}</p>
                  <h3>{currentApplications.length ? "Choose a verified applicant." : "Waiting for a helper to apply."}</h3>
                  <p>
                    {currentApplications.length
                      ? "Each application was signed by the applicant wallet. Selecting one records its consent hash on Arc."
                      : "Switch to Helper, connect the second wallet and sign an application. No application fee is required."}
                  </p>
                </div>
                <div className="resident-job-actions">
                  <button onClick={() => {
                    setRole("helper");
                    window.setTimeout(() => {
                      document.getElementById("job-board")?.scrollIntoView({ behavior: "smooth" });
                      void refreshLiveJobBoard();
                    }, 80);
                  }}>Open Helper Job Board</button>
                  <button className="refund-button" onClick={cancelAndRefundLiveJob} disabled={Boolean(liveBusy)}>
                    Cancel & refund escrow
                  </button>
                </div>
                {liveError && <p className="live-error">{liveError}</p>}
              </div>

              {currentApplications.length > 0 && (
                <div className="signed-applications">
                  {currentApplications.map((application, index) => (
                    <article key={`${application.jobId}-${application.provider}`}>
                      {index === 0 && <span className="top-signed">EARLIEST APPLICATION</span>}
                      <div className="wallet-avatar">{application.provider.slice(2, 4).toUpperCase()}</div>
                      <div>
                        <p className="kicker">WALLET-SIGNED APPLICANT</p>
                        <h3>{application.provider.slice(0, 8)}...{application.provider.slice(-6)}</h3>
                        <small>Applied {new Date(application.appliedAt).toLocaleString()}</small>
                      </div>
                      <div className="consent-proof">
                        <small>Consent hash</small>
                        <code>{application.applicationHash.slice(0, 12)}...{application.applicationHash.slice(-8)}</code>
                      </div>
                      <button onClick={() => void assignLiveProvider(application)} disabled={Boolean(liveBusy)}>
                        Select on Arc <span>→</span>
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {jobStage === "assigned" && (
            <>
              <div className="assigned-card match-entry">
                <div className="wallet-avatar large">{liveProvider.slice(2, 4).toUpperCase() || "AP"}<span>✓</span></div>
                <div>
                  <p className="kicker">APPLICANT SELECTED</p>
                  <h3>{liveProvider.slice(0, 8)}...{liveProvider.slice(-6)} is confirmed.</h3>
                  <p>The other applicants have been notified. Escrow remains locked until work is submitted and approved.</p>
                </div>
                <div className="assigned-state"><span>01</span><b>{liveStage === "completed" ? "Settled" : liveStage === "rejected" ? "Refunded" : liveStage === "disputed" ? "Disputed" : liveStage === "submitted" ? "Submitted" : "Assigned"}</b><small>{liveStage === "completed" ? "Arc settlement final" : liveStage === "rejected" ? "Escrow returned" : liveStage === "disputed" ? "Awaiting evaluator" : liveStage === "submitted" ? "Next: resident review" : "Next: work begins"}</small></div>
              </div>
              <div className="live-lifecycle">
                  <div className={liveStage !== "assigned" ? "done" : "active"}>
                    <span>1</span><b>Provider submits</b>
                    <small>Upload a photo, video or PDF from the assigned provider wallet.</small>
                    <label className="evidence-upload">
                      <input
                        type="file"
                        accept="image/*,video/*,application/pdf"
                        onChange={(event) => {
                          setEvidenceFile(event.target.files?.[0] ?? null);
                          setEvidenceRecord(null);
                        }}
                        disabled={liveStage !== "assigned"}
                      />
                      <b>{evidenceFile?.name ?? "Choose evidence file"}</b>
                      <small>{evidenceFile ? `${(evidenceFile.size / 1024 / 1024).toFixed(2)} MB` : "Maximum 10 MB"}</small>
                    </label>
                    <button onClick={submitLiveWork} disabled={liveStage !== "assigned" || !evidenceFile || Boolean(liveBusy)}>Upload + anchor on Arc</button>
                  </div>
                  <div className={["completed", "rejected", "disputed"].includes(liveStage) ? "done" : liveStage === "submitted" ? "active" : ""}>
                    <span>2</span><b>Resident reviews</b>
                    <small>The client can approve, reject with a refund, or ask for human review.</small>
                    {evidenceRecord && (
                      <a className="evidence-record" href={evidenceRecord.uri} target="_blank" rel="noreferrer">
                        <b>{evidenceRecord.name}</b>
                        <small>{evidenceRecord.evidenceHash.slice(0, 14)}...{evidenceRecord.evidenceHash.slice(-8)}</small>
                      </a>
                    )}
                    <div className="evidence-actions">
                      <button onClick={completeLiveJob} disabled={liveStage !== "submitted" || Boolean(liveBusy)}>Approve + pay</button>
                      <button className="secondary-action" onClick={rejectLiveEvidence} disabled={liveStage !== "submitted" || Boolean(liveBusy)}>Reject + refund</button>
                      <button className="secondary-action" onClick={disputeLiveJob} disabled={liveStage !== "submitted" || Boolean(liveBusy)}>Open dispute</button>
                    </div>
                  </div>
                  <div className={liveStage === "completed" ? "done" : liveStage === "disputed" ? "active" : ""}>
                    <span>3</span><b>Settlement final</b>
                    <small>
                      Provider receives {payoutPreview?.provider.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") ?? "-"} USDC;
                      fee is {payoutPreview?.fee.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") ?? "-"} USDC.
                    </small>
                    {liveStage === "disputed" && (
                      <div className="evidence-actions">
                        <button onClick={() => resolveLiveDispute(0)} disabled={Boolean(liveBusy)}>Refund resident</button>
                        <button onClick={() => resolveLiveDispute(5000)} disabled={Boolean(liveBusy)}>Split 50 / 50</button>
                        <button onClick={() => resolveLiveDispute(10000)} disabled={Boolean(liveBusy)}>Pay provider</button>
                      </div>
                    )}
                  </div>
                  {liveBusy && <p className="live-busy">{liveBusy}</p>}
                  {liveError && <p className="live-error">{liveError}</p>}
              </div>
            </>
          )}

          {liveTxs.length > 0 && (
            <div className="live-transactions">
              <p className="kicker">THIS SESSION ON ARCSCAN</p>
              {liveTxs.map((transaction) => (
                <a key={transaction.hash} href={`https://testnet.arcscan.app/tx/${transaction.hash}`} target="_blank">
                  <span>{transaction.label}</span><code>{transaction.hash.slice(0, 12)}...{transaction.hash.slice(-8)}</code><b>View ↗</b>
                </a>
              ))}
            </div>
          )}

          {jobStage !== "assigned" && taskBlocked && (
            <div className={`no-match-panel ${taskBlocked ? "safety" : ""}`}>
              <span>{taskBlocked ? "!" : "?"}</span>
              <div>
                <p className="kicker">{taskBlocked ? "SAFETY GATE" : "APPLICATIONS OPEN"}</p>
                <h3>
                  {taskBlocked
                    ? "This task needs a licensed or specifically verified professional."
                    : "No verified applicants have applied yet."}
                </h3>
                <p>
                  {taskBlocked
                    ? "LocalMate will not publish medical care, hazardous technical work or sensitive childcare to unqualified neighbors."
                    : "The funded job remains open. The agent can recommend a higher budget, a wider time window or clearer required skills."}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section id="trust" className="story-section">
        <div className="story-image clean scroll-reveal reveal-left" />
        <div className="story-copy scroll-reveal reveal-right">
          <p className="kicker light">TRUST YOU CAN UNDERSTAND</p>
          <h2>A score is only useful<br />when you know why.</h2>
          <p>LocalMate never guesses character from a photo. It uses verified identity, relevant experience, real settlements, reliability and repeat relationships.</p>
          <div className="trust-breakdown">
            <div><span>94</span><p><b>Trust score</b><small>Identity + proven history</small></p></div>
            <ul>
              <li><span>Verified identity</span><b>20 / 20</b></li>
              <li><span>Completed jobs</span><b>24 / 25</b></li>
              <li><span>Verified reviews</span><b>14 / 15</b></li>
              <li><span>Reliability</span><b>10 / 10</b></li>
            </ul>
          </div>
        </div>
      </section>

      <section id="work" className="work-section section wrap">
        <div className="work-copy scroll-reveal reveal-left">
          <p className="kicker">MADE FOR REAL-LIFE TASKS</p>
          <h2>From “I need a hand”<br />to handled.</h2>
          <div className="steps">
            <div><span>01</span><p><b>Post a funded job</b><small>The agent prepares the brief and locks the budget in Arc escrow.</small></p></div>
            <div><span>02</span><p><b>Applicants opt in</b><small>Only available helpers who accept the scope and budget apply.</small></p></div>
            <div><span>03</span><p><b>Choose and settle</b><small>AI ranks applicants; you choose, then approve payment after completion.</small></p></div>
          </div>
        </div>
        <div className="work-visual scroll-reveal reveal-right">
          <div className="story-image move" />
          <div className="completion-card"><span>✓</span><div><b>Sofa moved safely</b><small>Evidence submitted · 18 USDC ready</small></div></div>
        </div>
      </section>

      <section id="arc" className="arc-section">
        <div className="wrap arc-grid">
          <div className="scroll-reveal reveal-left">
            <p className="kicker light">PROGRAMMABLE SETTLEMENT ON ARC</p>
            <h2>Friendly on the surface.<br />Verifiable underneath.</h2>
            <p>Every job follows a transparent lifecycle. Private home details stay offchain; the payment and completion record stay verifiable.</p>
            <a href="https://docs.arc.io/build/agentic-economy" target="_blank">Explore the Arc integration →</a>
          </div>
          <div className="arc-flow scroll-reveal reveal-right">
            {["Open", "Funded", "Submitted", "Completed"].map((stage, index) => (
              <div key={stage} className={index < 3 ? "done" : "current"}>
                <span>{index < 3 ? "✓" : "04"}</span>
                <p><b>{stage}</b><small>{["Agent creates the job", "USDC locked in escrow", "Helper sends deliverable", "Evaluator releases payment"][index]}</small></p>
              </div>
            ))}
          </div>
        </div>
        <div className="wrap arc-tech-grid">
          <a className="scroll-reveal reveal-delay-1" href={`https://testnet.arcscan.app/address/${deploymentV3.contractAddress}`} target="_blank">
            <span className="tech-icon">⌁</span><i>LIVE</i>
            <h3>Arc escrow V4</h3>
            <p>Circle SCA support, signed consent, evidence anchoring, disputes and programmable USDC settlement.</p>
            <small>{deploymentV3.contractAddress.slice(0, 8)}…{deploymentV3.contractAddress.slice(-6)} ↗</small>
          </a>
          <a className="scroll-reveal reveal-delay-2" href="https://developers.circle.com/gateway/nanopayments" target="_blank">
            <span className="tech-icon">ϟ</span><i>PLANNED</i>
            <h3>Arc nanopayments</h3>
            <p>Planned x402/Gateway rail for pay-per-review agent services.</p>
            <small>Design reference · Circle Gateway docs ↗</small>
          </a>
          <a className="scroll-reveal reveal-delay-3" href="https://docs.arc.io/arc/tutorials/register-your-first-ai-agent" target="_blank">
            <span className="tech-icon">◎</span><i>METADATA READY</i>
            <h3>ERC-8004 agent</h3>
            <p>LocalMate agent metadata is prepared for registry registration.</p>
            <small>Next step · register identity and reputation ↗</small>
          </a>
          <a className="scroll-reveal reveal-delay-4" href="https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job" target="_blank">
            <span className="tech-icon">✓</span><i>COMPATIBLE</i>
            <h3>ERC-8183-style job</h3>
            <p>LocalMate V4 implements a compatible job, escrow and settlement lifecycle.</p>
            <small>LocalMate V4 · Circle SCA + evidence + dispute extensions ↗</small>
          </a>
        </div>
        <div className="wrap activity-panel scroll-reveal">
          <div className="activity-head"><div><span className="status-dot" /> LIVE ON ARC TESTNET</div><a href="https://testnet.arcscan.app" target="_blank">Open Arcscan ↗</a></div>
          {activity.map((item, index) => (
            <a
              className="activity-row"
              key={item[0]}
              href={index === 0 ? `https://testnet.arcscan.app/tx/${deploymentV3.payoutTxHash}` : "https://testnet.arcscan.app"}
              target="_blank"
            >
              <b>{item[0]}</b><span className={item[1].toLowerCase()}>{item[1]}</span><strong>{item[2]}</strong><small>{item[3]}</small>
            </a>
          ))}
          <div className="deployment-proof">
            <span>LIVE DEMO CONTRACT</span>
            <code>{deploymentV3.contractAddress}</code>
            <a href={`https://testnet.arcscan.app/address/${deploymentV3.contractAddress}`} target="_blank">Inspect V4 contract ↗</a>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="wrap cta-inner scroll-reveal">
          <div><p className="kicker">YOUR COMMUNITY IS READY</p><h2>What could a neighbor<br />help you with today?</h2></div>
          <button onClick={() => document.getElementById("top")?.scrollIntoView({ behavior: "smooth" })}>Post your first task <span>→</span></button>
        </div>
      </section>

      <footer>
        <div className="wrap footer-inner">
          <a className="brand" href="#top"><span className="brand-mark">L</span><span>LocalMate</span></a>
          <p>Trusted local help, settled on Arc.</p>
          <div><a href="#services">Services</a><a href="#trust">Trust</a><a href="#arc">Arc</a></div>
          <small>Hackathon MVP · Simulated community data · Arc Testnet</small>
        </div>
      </footer>

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <div className="profile-modal" onMouseDown={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}>×</button>
            <div className={`profile-avatar large ${selected.tone}`}>{selected.initials}<span>✓</span></div>
            <p className="kicker">APPLICANT TRUST REVIEW</p>
            <h2>{selected.name}</h2>
            <p className="modal-role">{selected.role} · Sunrise Riverside</p>
            <div className="modal-scores"><span><b>{selected.trust}</b><small>Trust</small></span><span><b>{selected.match}</b><small>Match</small></span><span><b>{selected.jobs}</b><small>Jobs</small></span></div>
            <div className="why-box"><b>✦ Why this match</b><p>{selected.note}</p><p>Available at the requested time and within your maximum budget.</p></div>
            <div className="policy"><span>Arc escrow</span><b>{selected.price}</b></div>
            <button className="choose-button" onClick={() => {
              setChosenHelper(selected);
              setSelected(null);
              setNotice(`${selected.name} shortlisted. Their signed wallet application is still required before onchain assignment.`);
            }}>Select {selected.name.split(" ")[0]} <span>→</span></button>
            <small className="fine-print">This applicant already accepted the job scope, timing and posted budget.</small>
          </div>
        </div>
      )}
    </main>
  );
}
