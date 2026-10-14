require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置 multer 用于文件上传
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      '.pdf', '.doc', '.docx', '.txt', '.md'
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.doc', '.docx', '.txt', '.md'].includes(ext) || allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'), false);
    }
  }
});

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 确保上传目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 提取文本内容的辅助函数
async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === '.txt' || ext === '.md') {
      return fs.readFileSync(filePath, 'utf-8');
    }

    if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text;
      } catch (e) {
        console.warn('PDF 解析失败，返回提示信息:', e.message);
        return `[PDF文件: ${originalName}，无法自动解析文本内容，请手动粘贴合同文本]`;
      }
    }

    if (ext === '.doc' || ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
      } catch (e) {
        console.warn('Word 解析失败，返回提示信息:', e.message);
        return `[Word文件: ${originalName}，无法自动解析文本内容，请手动粘贴合同文本]`;
      }
    }

    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    console.error('文件读取失败:', e.message);
    return `[文件: ${originalName}，读取失败，请手动粘贴合同文本]`;
  }
}

// 调用扣子工作流
async function callCozeWorkflow(params) {
  const patToken = process.env.COZE_PAT_TOKEN;
  const workflowId = process.env.COZE_WORKFLOW_ID;
  const apiBase = process.env.COZE_API_BASE || 'https://api.coze.cn';

  if (!patToken || !workflowId) {
    throw new Error('扣子工作流配置不完整，请检查 .env 文件中的 COZE_PAT_TOKEN 和 COZE_WORKFLOW_ID');
  }

  const url = `${apiBase}/v1/workflow/run`;

  const requestBody = {
    workflow_id: workflowId,
    parameters: params
  };

  console.log('调用扣子工作流:', { workflowId, parameters: { ...params, contractText: params.contractText ? params.contractText.substring(0, 100) + '...' : '(无)' } });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${patToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('扣子 API 错误:', response.status, errorText);
    throw new Error(`扣子工作流调用失败 (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log('扣子工作流返回结果摘要:', JSON.stringify(result).substring(0, 200));
  return result;
}

// 解析扣子返回的结果
function parseCozeResult(cozeResult) {
  // 扣子工作流返回格式通常为 { code: 0, msg: "success", data: "..." }
  // data 可能是 JSON 字符串，需要解析
  try {
    let data = cozeResult.data;

    if (typeof data === 'string') {
      // 尝试解析 JSON 字符串
      try {
        data = JSON.parse(data);
      } catch {
        // 如果不是 JSON，作为纯文本处理
        return {
          raw: data,
          summary: data,
          opinions: [],
          legalVerification: null,
          companyVerification: null,
          reportUrl: null
        };
      }
    }

    // 如果 data 是对象，尝试提取结构化信息
    if (typeof data === 'object' && data !== null) {
      return {
        summary: data.summary || data.审查摘要 || data.reviewSummary || '审查完成',
        opinions: data.opinions || data.审查意见 || data.reviewOpinions || [],
        legalVerification: data.legalVerification || data.法律引用核验 || data.legalCheck || null,
        companyVerification: data.companyVerification || data.企业信息核验 || data.companyCheck || null,
        reportUrl: data.reportUrl || data.飞书报告地址 || data.feishuUrl || null,
        riskCount: data.riskCount || data.风险统计 || null,
        raw: data
      };
    }

    return {
      summary: '审查完成',
      opinions: [],
      legalVerification: null,
      companyVerification: null,
      reportUrl: null,
      raw: data
    };
  } catch (e) {
    console.error('解析扣子结果失败:', e);
    return {
      summary: '审查完成（结果解析异常）',
      opinions: [],
      legalVerification: null,
      companyVerification: null,
      reportUrl: null,
      raw: cozeResult
    };
  }
}

// API 路由：提交合同审查
app.post('/api/review', upload.single('contractFile'), async (req, res) => {
  try {
    const {
      contractType,
      reviewStance,
      focusAreas,
      additionalRequirements,
      contractText
    } = req.body;

    // 获取文件内容
    let fileContent = '';
    let fileName = '';

    if (req.file) {
      fileName = req.file.originalname;
      fileContent = await extractTextFromFile(req.file.path, fileName);
      // 清理上传的临时文件
      try { fs.unlinkSync(req.file.path); } catch {}
    }

    // 合并文本内容
    const finalContractText = contractText || fileContent;

    if (!finalContractText || finalContractText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: '请上传合同文件或粘贴合同文本'
      });
    }

    // 构建扣子工作流参数
    const workflowParams = {
      contractText: finalContractText,
      contractType: contractType || '其他合同',
      reviewStance: reviewStance || '中立',
      focusAreas: focusAreas || '',
      additionalRequirements: additionalRequirements || '',
      fileName: fileName || '(粘贴文本)'
    };

    // 调用扣子工作流
    const cozeResult = await callCozeWorkflow(workflowParams);

    // 解析结果
    const parsedResult = parseCozeResult(cozeResult);

    res.json({
      success: true,
      data: parsedResult,
      isDemo: false
    });

  } catch (error) {
    console.error('合同审查失败:', error.message);

    // 如果是扣子配置问题或网络问题，返回模拟数据并标记为演示
    if (error.message.includes('扣子工作流配置不完整') ||
        error.message.includes('fetch failed') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND')) {

      const mockResult = generateMockResult(req.body);
      return res.json({
        success: true,
        data: mockResult,
        isDemo: true,
        errorInfo: `扣子工作流暂时无法连接: ${error.message}，当前显示演示数据`
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 生成模拟结果（演示用）
function generateMockResult(params) {
  const contractType = params.contractType || '采购合同';
  const stance = params.reviewStance || '甲方';

  return {
    summary: `已完成对${contractType}的审查，共发现 5 条审查意见，其中高风险 1 条、中风险 2 条、低风险 2 条。`,
    opinions: [
      {
        id: 1,
        title: '付款条件不明确，缺少具体付款时间节点',
        riskLevel: 'high',
        riskLabel: '高风险',
        analysis: '合同第四条约定"验收合格后付款"，但未明确验收标准、验收期限以及付款的具体天数。根据《民法典》第六百二十八条，买受人应当在检验期间内将标的物的数量或者质量不符合约定的情形通知出卖人。模糊的付款条件可能导致双方对付款时间产生争议。',
        suggestion: '建议修改为："甲方应在乙方交付货物并经甲方验收合格之日起 30 个工作日内，以银行转账方式支付合同总价款。验收标准详见附件一《验收标准》。"',
        legalRef: '《民法典》第六百二十八条'
      },
      {
        id: 2,
        title: '违约金比例过高，可能被认定为无效条款',
        riskLevel: 'high',
        riskLabel: '高风险',
        analysis: '合同第八条约定违约金为合同总价的 30%。根据相关司法解释，违约金一般不超过实际损失的 30%，过高的违约金条款可能被法院调减，且对守约方而言也存在被反诉的风险。',
        suggestion: '建议将违约金调整为合同总价的 10%-15%，并增加"违约金不足以弥补损失的，违约方还应赔偿实际损失"的兜底条款。',
        legalRef: '《民法典》第五百八十五条'
      },
      {
        id: 3,
        title: '知识产权归属约定不清',
        riskLevel: 'medium',
        riskLabel: '中风险',
        analysis: '合同未明确约定在合同履行过程中产生的知识产权归属。如果涉及定制化产品或技术开发，可能引发知识产权纠纷。',
        suggestion: '建议增加知识产权条款："合同履行过程中产生的知识产权（包括但不限于专利权、著作权、商业秘密）归甲方所有，乙方不得擅自使用或向第三方披露。"',
        legalRef: '《专利法》第八条、《著作权法》第十七条'
      },
      {
        id: 4,
        title: '争议解决条款约定不完整',
        riskLevel: 'medium',
        riskLabel: '中风险',
        analysis: '合同仅约定"双方协商解决"，未约定协商不成时的争议解决方式和管辖法院，可能导致管辖权争议。',
        suggestion: '建议修改为："本合同在履行过程中如发生争议，双方应友好协商解决；协商不成的，任何一方均有权向甲方所在地有管辖权的人民法院提起诉讼。"',
        legalRef: '《民事诉讼法》第三十五条'
      },
      {
        id: 5,
        title: '缺少合同解除和终止条款',
        riskLevel: 'low',
        riskLabel: '低风险',
        analysis: '合同未约定解除和终止的条件和程序。在实际履行中，如遇不可抗力或其他特殊情况，缺乏合同解除依据可能导致纠纷扩大。',
        suggestion: '建议增加合同解除条款："任何一方因不可抗力导致合同无法履行的，应在 15 日内书面通知对方，并提供相关证明。双方均不承担违约责任。"',
        legalRef: '《民法典》第五百六十三条、第五百九十条'
      }
    ],
    legalVerification: {
      status: '核验完成',
      summary: '引用的法律条文经核验均现行有效。建议关注《民法典》合同编最新司法解释中关于违约金的认定标准。',
      details: [
        { law: '《民法典》第六百二十八条', status: '有效', note: '现行有效' },
        { law: '《民法典》第五百八十五条', status: '有效', note: '现行有效' },
        { law: '《专利法》第八条', status: '有效', note: '2021年修订版' },
        { law: '《民事诉讼法》第三十五条', status: '有效', note: '2024年修订版' }
      ]
    },
    companyVerification: {
      status: '核验完成',
      summary: '合同相对方企业信息核验已完成，建议签署前再次确认对方的签约代表权限。',
      details: [
        { item: '企业工商信息', status: '正常', note: '企业状态正常，无经营异常' },
        { item: '涉诉信息', status: '无重大风险', note: '近3年无重大涉诉记录' },
        { item: '失信信息', status: '正常', note: '未列入失信被执行人名单' }
      ]
    },
    reportUrl: null
  };
}

// 健康检查
app.get('/api/health', (req, res) => {
  const hasConfig = !!(process.env.COZE_PAT_TOKEN && process.env.COZE_WORKFLOW_ID);
  res.json({
    status: 'ok',
    cozeConfigured: hasConfig,
    timestamp: new Date().toISOString()
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  合同审查工作台已启动`);
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`  扣子工作流: ${process.env.COZE_WORKFLOW_ID ? '已配置' : '未配置'}`);
  console.log(`${'='.repeat(50)}\n`);
});