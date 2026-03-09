# 📝 Jira Repository Configuration Guide

There are 3 methods to specify which repository AI Cyber Bot should work on.

---

## 🎯 Method 1: Write in Description (EASIEST - RECOMMENDED)

Add repository information to the task's **Description** section. The system will automatically detect it.

### Format Options:

**Option A: Tagged Format (Clearest)**
```
Repository: username/repository-name
```

**Option B: URL Format**
```
https://github.com/username/repository-name
```

**Option C: Just Repo Name**
```
username/repository-name
```

### Example Description:

```
Add email validation to Member model.

Requirements:
- Email must contain @ symbol
- Email must have a domain
- Invalid emails should return 400 Bad Request

Repository: username/repository-name
```

or

```
Add email validation to Member model.

Requirements:
- Email must contain @ symbol
- Email must have a domain
- Invalid emails should return 400 Bad Request

Test repository: https://github.com/username/repository-name
```

---

## 🎯 Method 2: Create Custom Field (MOST PROFESSIONAL)

Create a custom field named "Repository" in Jira.

### Steps:

1. **Settings (⚙️) > Issues > Custom fields**
2. **"Create custom field"**
3. **Type:** "Short text (plain text)"
4. **Name:** `Repository`
5. **Description:** `GitHub/GitLab repository (e.g., username/repo)`
6. **Associate to screens:** Default Screen
7. **Create**

### Usage:

When creating a task, in the "Repository" field:
```
username/repository-name
```

---

## 🎯 Method 3: Specify Field ID in .env (MANUAL)

If you know the custom field ID, add it to the `.env` file:

```env
JIRA_REPO_FIELD_ID=customfield_10042
```

---

## ✅ Which Method Should I Choose?

| Method | Difficulty | Speed | Recommended |
|--------|-----------|-------|-------------|
| **Description** | ⭐ Very Easy | ⚡ Instant | ✅ Yes |
| **Custom Field** | ⭐⭐ Medium | ⏱️ 5 minutes | ✅ For Production |
| **.env Manual** | ⭐⭐⭐ Hard | ⏱️ 10 minutes | ❌ Not necessary |

---

## 🚀 Quick Test (30 Seconds)

1. **Open your Jira task**
2. **Edit Description**
3. **Add at the bottom:**
   ```
   Repository: username/repository-name
   ```
4. **Save**
5. **Restart system** (or wait 15 seconds - polling interval)

---

## 📊 How the System Works

```
1. Does Custom Field exist? 
   ├─ Yes → Read from Custom Field
   └─ No → Look in Description
   
2. Is repository in Description?
   ├─ "Repository: username/repo" → Find ✅
   ├─ "https://github.com/username/repo" → Find ✅
   ├─ "username/repo" → Find ✅
   └─ None → Error ❌
```

---

## 🔍 Supported Formats

### ✅ Valid Formats:

```
Repository: username/repository-name
Repo: username/repository-name
repository: username/repository-name
repo: username/repository-name

https://github.com/username/repository-name
github.com/username/repository-name

username/repository-name
```

### ❌ Invalid Formats:

```
username (only username)
repository-name (only repo name)
www.github.com (URL but no repo)
```

---

## 💡 Tips

1. **Copy-paste repository name** - avoid typos
2. **Slash (/) character is required** - `username/repo` format
3. **Case doesn't matter** - "Repository" or "repository" both work
4. **Auto-parsed from URL** - Full GitHub URL also works

---

## 🆘 Troubleshooting

### Getting "No repository found" error:

**Check 1:** Is repository in Description?
```
✅ Repository: username/repository-name
❌ Repository username/repository-name (missing :)
```

**Check 2:** Is format correct?
```
✅ username/repo
❌ username-repo (missing /)
```

**Check 3:** Was system restarted?
```bash
# Stop with Ctrl+C
npm run dev
```

---

## 📚 Examples

### Example 1: Simple Task

```
Summary: Add email validation

Description:
Add email validation to the registerUser function.

Repository: username/repository-name
```

### Example 2: Detailed Task

```
Summary: Fix bug in user registration

Description:
The system currently allows duplicate emails.

Steps to reproduce:
1. Create user with email test@example.com
2. Create another user with same email
3. Both succeed (should fail on second)

Expected: Second request should return 400
Current: Both requests succeed

Repository: https://github.com/username/repository-name
```

### Example 3: Minimal Task

```
Summary: Add validation

Description:
username/repository-name

Add email validation to Member model.
```

---

## 🎉 Success!

Now you know how to specify repositories! Test the system:

1. Update your Jira task
2. Wait 15 seconds
3. Check logs:
   ```
   INFO - Repository found in description: username/repository-name
   INFO - Processing issue KAN-XXX
   ```

**Good luck! 🚀**
