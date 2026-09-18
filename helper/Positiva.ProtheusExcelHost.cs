using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Xml.Linq;

public static class PositivaProtheusExcelHost
{
    private const string DefaultWorkbookPath = "C:\\Users\\Alexandre Mallorca\\OneDrive - Positiva Administradora de Benef\u00edcios Ltda\\Documentos\\Financeiro\\Comiss\u00f5es (Interno).xlsx";
    private const string DefaultSoomarDirectory = "C:\\Users\\Alexandre Mallorca\\OneDrive - Positiva Administradora de Benef\u00edcios Ltda\\Documentos\\Financeiro\\Outros e POP's\\Soomar";
    private const string DefaultJorgeDirectory = "C:\\Users\\Alexandre Mallorca\\OneDrive - Positiva Administradora de Benef\u00edcios Ltda\\Documentos\\Financeiro\\Outros e POP's\\Arquivos para Automacao\\Reembolso Plano jorge";
    private const string DefaultIssCorretoraDirectory = "C:\\Users\\Alexandre Mallorca\\OneDrive - Positiva Administradora de Benef\u00edcios Ltda\\Documentos\\Financeiro\\Outros e POP's\\Arquivos para Automacao\\ISS Corretora";
    private static readonly XNamespace SpreadsheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    private sealed class ExportRow
    {
        public string Name;
        public long PrimaryCents;
        public long AdditionalCents;
        public long Additional2Cents;
        public string Status;
    }

    private sealed class Layout
    {
        public string EntryName;
        public XDocument Document;
        public int HeaderRow;
        public int NameCol;
        public int DateCol;
        public int TotalCol;
        public int PrimaryCol;
        public int AdditionalCol;
        public int Additional2Col;
        public int DataStartRow;
        public int DataEndRow;
        public int LastRow;
    }

    private sealed class FormulaSnapshot
    {
        public string CellRef;
        public string FormulaXml;
    }

    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            Dictionary<string, object> request = ReadNativeMessage();
            Dictionary<string, object> response = Process(request);
            WriteNativeMessage(response);
            return 0;
        }
        catch (Exception ex)
        {
            try
            {
                WriteNativeMessage(new Dictionary<string, object>
                {
                    { "ok", false },
                    { "error", ex.Message },
                    { "detail", ex.ToString() }
                });
            }
            catch { }
            return 1;
        }
    }

    private static Dictionary<string, object> Process(Dictionary<string, object> request)
    {
        string action = GetString(request, "action");
        if (string.Equals(action, "readSoomarExpenses", StringComparison.OrdinalIgnoreCase))
            return ReadSoomarExpenses(request);
        if (string.Equals(action, "readJorgeReimbursementPdf", StringComparison.OrdinalIgnoreCase))
            return ReadJorgeReimbursementPdf(request);
        if (string.Equals(action, "readIssCorretoraPdf", StringComparison.OrdinalIgnoreCase))
            return ReadIssCorretoraPdf(request);
        if (string.Equals(action, "readIssCorretoraCsvSources", StringComparison.OrdinalIgnoreCase))
            return ReadIssCorretoraCsvSources(request);

        if (!string.Equals(action, "syncInternalCommissions", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Ação nativa desconhecida: " + action);

        string workbookPath = GetString(request, "workbookPath");
        if (string.IsNullOrWhiteSpace(workbookPath)) workbookPath = DefaultWorkbookPath;
        if (!File.Exists(workbookPath)) throw new FileNotFoundException("Arquivo principal de comissões não encontrado.", workbookPath);

        DateTime paymentDate;
        string dateText = GetString(request, "date");
        if (!DateTime.TryParseExact(dateText, "dd/MM/yyyy", CultureInfo.GetCultureInfo("pt-BR"), DateTimeStyles.None, out paymentDate))
            throw new InvalidOperationException("Data de referência inválida recebida da extensão: " + dateText);

        List<ExportRow> rows = ParseRows(request);
        if (rows.Count == 0) throw new InvalidOperationException("Nenhuma comissão interna foi recebida para atualização.");

        return SyncInternalCommissionsOpenXml(workbookPath, paymentDate, rows);
    }

    private static Dictionary<string, object> ReadJorgeReimbursementPdf(Dictionary<string, object> request)
    {
        string period = GetString(request, "period").Trim();
        if (period.Length == 0) period = DateTime.Now.ToString("yyyyMM", CultureInfo.InvariantCulture);
        if (!Regex.IsMatch(period, @"^\d{6}$"))
            throw new InvalidOperationException("Período do Reembolso Plano Jorge inválido. Esperado AAAAMM: " + period);

        string directory = GetString(request, "directory").Trim();
        if (directory.Length == 0) directory = DefaultJorgeDirectory;
        string month = period.Substring(4, 2);
        string fileName = month + ".pdf";
        string pdfPath = Path.Combine(directory, fileName);
        if (!File.Exists(pdfPath))
            throw new FileNotFoundException("PDF do Reembolso Plano Jorge não encontrado: " + pdfPath, pdfPath);

        byte[] bytes = File.ReadAllBytes(pdfPath);
        if (bytes == null || bytes.Length == 0)
            throw new InvalidDataException("PDF do Reembolso Plano Jorge está vazio: " + pdfPath);

        return new Dictionary<string, object>
        {
            { "ok", true },
            { "period", period },
            { "pdfPath", pdfPath },
            { "pdfName", fileName },
            { "pdfBase64", Convert.ToBase64String(bytes) },
            { "reader", "direct-bytes" }
        };
    }

    private static Dictionary<string, object> ReadIssCorretoraPdf(Dictionary<string, object> request)
    {
        string requestedPeriod = GetString(request, "period").Trim();
        if (requestedPeriod.Length > 0 && !Regex.IsMatch(requestedPeriod, @"^\d{6}$"))
            throw new InvalidOperationException("Período do ISS Corretora inválido. Esperado AAAAMM: " + requestedPeriod);

        string directory = GetString(request, "directory").Trim();
        if (directory.Length == 0) directory = DefaultIssCorretoraDirectory;
        if (!Directory.Exists(directory))
            throw new DirectoryNotFoundException("Pasta do ISS Corretora não encontrada: " + directory);

        Regex filePattern = new Regex(@"^CORRETORA_GUIA_ISS_DAMSP_58345965_(\d{6})\.PDF$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        List<string> candidates = new List<string>();
        foreach (string path in Directory.GetFiles(directory, "*", SearchOption.TopDirectoryOnly))
        {
            string name = Path.GetFileName(path);
            Match match = filePattern.Match(name);
            if (!match.Success) continue;
            string period = match.Groups[1].Value;
            if (requestedPeriod.Length > 0 && !string.Equals(period, requestedPeriod, StringComparison.Ordinal)) continue;
            candidates.Add(path);
        }

        candidates.Sort(StringComparer.OrdinalIgnoreCase);
        if (candidates.Count == 0)
        {
            string suffix = requestedPeriod.Length > 0 ? " para a competência " + requestedPeriod : "";
            throw new FileNotFoundException("PDF do ISS Corretora não encontrado" + suffix + " em: " + directory);
        }
        if (candidates.Count > 1)
        {
            string names = string.Join(", ", candidates.Select(path => Path.GetFileName(path)).ToArray());
            throw new InvalidOperationException("ISS Corretora: mais de um PDF compatível foi encontrado. Informe/defina a competência antes de continuar. Arquivos: " + names);
        }

        string pdfPath = candidates[0];
        string fileName = Path.GetFileName(pdfPath);
        Match selectedMatch = filePattern.Match(fileName);
        string selectedPeriod = selectedMatch.Groups[1].Value;
        int month;
        int year;
        if (!int.TryParse(selectedPeriod.Substring(0, 4), NumberStyles.None, CultureInfo.InvariantCulture, out year) ||
            !int.TryParse(selectedPeriod.Substring(4, 2), NumberStyles.None, CultureInfo.InvariantCulture, out month) ||
            month < 1 || month > 12)
            throw new InvalidOperationException("Competência inválida no nome do PDF do ISS Corretora: " + selectedPeriod);

        byte[] bytes = File.ReadAllBytes(pdfPath);
        if (bytes == null || bytes.Length == 0)
            throw new InvalidDataException("PDF do ISS Corretora está vazio: " + pdfPath);

        return new Dictionary<string, object>
        {
            { "ok", true },
            { "period", selectedPeriod },
            { "pdfPath", pdfPath },
            { "pdfName", fileName },
            { "pdfBase64", Convert.ToBase64String(bytes) },
            { "reader", "direct-bytes" }
        };
    }

    private static Dictionary<string, object> ReadIssCorretoraCsvSources(Dictionary<string, object> request)
    {
        string period = GetString(request, "period").Trim();
        if (!Regex.IsMatch(period, @"^\d{6}$"))
            throw new InvalidOperationException("Período dos CSVs do ISS Corretora inválido. Esperado AAAAMM: " + period);

        int year;
        int month;
        if (!int.TryParse(period.Substring(0, 4), NumberStyles.None, CultureInfo.InvariantCulture, out year) ||
            !int.TryParse(period.Substring(4, 2), NumberStyles.None, CultureInfo.InvariantCulture, out month) ||
            month < 1 || month > 12)
            throw new InvalidOperationException("Competência inválida para os CSVs do ISS Corretora: " + period);

        string directory = GetString(request, "directory").Trim();
        if (directory.Length == 0) directory = DefaultIssCorretoraDirectory;
        if (!Directory.Exists(directory))
            throw new DirectoryNotFoundException("Pasta do ISS Corretora não encontrada: " + directory);

        string startDate = period + "01";
        string endDate = period + DateTime.DaysInMonth(year, month).ToString("00", CultureInfo.InvariantCulture);
        string nfseEName = "NFSe_E_58345965_" + startDate + "_" + endDate + ".csv";
        string nfseName = "NFSe_58345965_" + startDate + "_" + endDate + ".csv";
        string nfseEPath = Path.Combine(directory, nfseEName);
        string nfsePath = Path.Combine(directory, nfseName);

        if (!File.Exists(nfseEPath))
            throw new FileNotFoundException("CSV NFSe_E do ISS Corretora não encontrado: " + nfseEPath, nfseEPath);
        if (!File.Exists(nfsePath))
            throw new FileNotFoundException("CSV NFSe do ISS Corretora não encontrado: " + nfsePath, nfsePath);

        Encoding sourceEncoding = Encoding.GetEncoding(1252);
        string nfseEText = File.ReadAllText(nfseEPath, sourceEncoding);
        string nfseText = File.ReadAllText(nfsePath, sourceEncoding);
        if (string.IsNullOrWhiteSpace(nfseEText))
            throw new InvalidDataException("CSV NFSe_E do ISS Corretora está vazio: " + nfseEPath);
        if (string.IsNullOrWhiteSpace(nfseText))
            throw new InvalidDataException("CSV NFSe do ISS Corretora está vazio: " + nfsePath);

        object[] sources = new object[]
        {
            new Dictionary<string, object>
            {
                { "sourceType", "NFSe_E" },
                { "fileName", nfseEName },
                { "filePath", nfseEPath },
                { "csvText", nfseEText }
            },
            new Dictionary<string, object>
            {
                { "sourceType", "NFSe" },
                { "fileName", nfseName },
                { "filePath", nfsePath },
                { "csvText", nfseText }
            }
        };

        return new Dictionary<string, object>
        {
            { "ok", true },
            { "period", period },
            { "csvSources", sources },
            { "reader", "csv-semicolon-windows-1252" }
        };
    }

    private static Dictionary<string, object> ReadSoomarExpenses(Dictionary<string, object> request)
    {
        string period = GetString(request, "period").Trim();
        if (period.Length == 0) period = DateTime.Now.ToString("yyyyMM", CultureInfo.InvariantCulture);
        if (!Regex.IsMatch(period, @"^\d{6}$"))
            throw new InvalidOperationException("Período Soomar inválido. Esperado AAAAMM: " + period);

        string directory = GetString(request, "directory").Trim();
        if (directory.Length == 0) directory = DefaultSoomarDirectory;
        string fileName = "PNB_Despesas_Soomar_" + period + ".xlsx";
        string workbookPath = Path.Combine(directory, fileName);
        if (!File.Exists(workbookPath))
            throw new FileNotFoundException("Arquivo Soomar do mês não encontrado: " + workbookPath, workbookPath);

        List<Dictionary<string, object>> rows = ReadSoomarExpensesOpenXml(workbookPath);
        return new Dictionary<string, object>
        {
            { "ok", true },
            { "period", period },
            { "workbookPath", workbookPath },
            { "workbookName", fileName },
            { "rows", rows.ToArray() },
            { "reader", "openxml-direct" }
        };
    }

    private static List<Dictionary<string, object>> ReadSoomarExpensesOpenXml(string workbookPath)
    {
        using (FileStream stream = new FileStream(workbookPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read, false))
        {
            List<string> sharedStrings = ReadSharedStrings(archive);
            foreach (ZipArchiveEntry entry in archive.Entries.Where(e => e.FullName.StartsWith("xl/worksheets/", StringComparison.OrdinalIgnoreCase) && e.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)))
            {
                XDocument document = LoadXmlEntry(entry);
                XElement sheetData = document.Root.Element(SpreadsheetNs + "sheetData");
                if (sheetData == null) continue;
                List<XElement> sheetRows = sheetData.Elements(SpreadsheetNs + "row").ToList();
                int headerRowNumber = 0;
                int valueColumn = 0;
                int historyColumn = 0;

                foreach (XElement row in sheetRows.Take(20))
                {
                    int currentValueColumn = 0;
                    int currentHistoryColumn = 0;
                    foreach (XElement cell in row.Elements(SpreadsheetNs + "c"))
                    {
                        string header = NormalizeHeader(GetCellText(cell, sharedStrings));
                        int col = GetColumnNumber(GetCellReference(cell));
                        if (header == "pnb_valor") currentValueColumn = col;
                        if (header == "pnb_hist") currentHistoryColumn = col;
                    }
                    if (currentValueColumn > 0 && currentHistoryColumn > 0)
                    {
                        headerRowNumber = GetRowNumber(row);
                        valueColumn = currentValueColumn;
                        historyColumn = currentHistoryColumn;
                        break;
                    }
                }

                if (headerRowNumber == 0) continue;
                var result = new List<Dictionary<string, object>>();
                foreach (XElement row in sheetRows.Where(r => GetRowNumber(r) > headerRowNumber).OrderBy(GetRowNumber))
                {
                    XElement valueCell = FindCell(row, valueColumn);
                    XElement historyCell = FindCell(row, historyColumn);
                    string history = GetCellText(historyCell, sharedStrings).Trim();
                    long valueCents = ParseMoneyCents(GetCellText(valueCell, sharedStrings));
                    if (valueCents == 0 || history.Length == 0) continue;
                    result.Add(new Dictionary<string, object>
                    {
                        { "rowNumber", GetRowNumber(row) },
                        { "history", history },
                        { "valueCents", valueCents }
                    });
                }
                return result;
            }
        }
        throw new InvalidDataException("Não foi possível localizar as colunas PNB_VALOR e PNB_HIST no arquivo Soomar.");
    }

    private static long ParseMoneyCents(string rawValue)
    {
        string raw = (rawValue ?? "").Replace("R$", "").Replace("\u00A0", " ").Trim();
        if (raw.Length == 0 || raw == "-") return 0;
        decimal value;
        if (raw.IndexOf(',') >= 0)
        {
            if (decimal.TryParse(raw, NumberStyles.Any, CultureInfo.GetCultureInfo("pt-BR"), out value))
                return Convert.ToInt64(Math.Round(value * 100m, MidpointRounding.AwayFromZero));
        }
        if (decimal.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out value))
            return Convert.ToInt64(Math.Round(value * 100m, MidpointRounding.AwayFromZero));
        if (decimal.TryParse(raw, NumberStyles.Any, CultureInfo.GetCultureInfo("pt-BR"), out value))
            return Convert.ToInt64(Math.Round(value * 100m, MidpointRounding.AwayFromZero));
        throw new InvalidDataException("Valor inválido encontrado em PNB_VALOR: " + rawValue);
    }

    private static Dictionary<string, object> SyncInternalCommissionsOpenXml(string workbookPath, DateTime paymentDate, List<ExportRow> rows)
    {
        string directory = Path.GetDirectoryName(workbookPath);
        string tempPath = Path.Combine(directory, ".positiva_sync_" + Guid.NewGuid().ToString("N") + ".xlsx");
        var missing = new List<string>();
        var ambiguous = new List<string>();
        int updated = 0;
        int insertedRows = 0;

        try
        {
            File.Copy(workbookPath, tempPath, true);

            using (FileStream stream = new FileStream(tempPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Update, false))
            {
                List<string> sharedStrings = ReadSharedStrings(archive);
                Layout layout = FindLayout(archive, sharedStrings);
                if (layout == null)
                    throw new InvalidOperationException("Não foi possível identificar com segurança Nome, Data, Valor, Adicional e Adicional 2 na planilha principal.");

                List<FormulaSnapshot> formulasBefore = CaptureFormulas(layout.Document);
                insertedRows = EnsureDataRowCapacity(layout, rows.Count);
                int capacity = layout.DataEndRow - layout.DataStartRow + 1;

                for (int i = 0; i < capacity; i++)
                {
                    int targetRow = layout.DataStartRow + i;
                    XElement nameCell = GetOrCreateCell(layout.Document, targetRow, layout.NameCol);
                    XElement dateCell = GetOrCreateCell(layout.Document, targetRow, layout.DateCol);
                    XElement primaryCell = GetOrCreateCell(layout.Document, targetRow, layout.PrimaryCol);
                    XElement additionalCell = GetOrCreateCell(layout.Document, targetRow, layout.AdditionalCol);
                    XElement additional2Cell = GetOrCreateCell(layout.Document, targetRow, layout.Additional2Col);

                    EnsureWritableInputCell(nameCell, "Nome", i < rows.Count ? rows[i].Name : "linha vazia");
                    EnsureWritableInputCell(dateCell, "Data", i < rows.Count ? rows[i].Name : "linha vazia");
                    EnsureWritableInputCell(primaryCell, "Valor", i < rows.Count ? rows[i].Name : "linha vazia");
                    EnsureWritableInputCell(additionalCell, "Adicional", i < rows.Count ? rows[i].Name : "linha vazia");
                    EnsureWritableInputCell(additional2Cell, "Adicional 2", i < rows.Count ? rows[i].Name : "linha vazia");

                    if (i < rows.Count)
                    {
                        ExportRow row = rows[i];
                        SetInlineTextValue(nameCell, row.Name);
                        SetNumericValue(dateCell, paymentDate.ToOADate().ToString("0.###############", CultureInfo.InvariantCulture), false);
                        SetMoneyValue(primaryCell, row.PrimaryCents);
                        SetMoneyValue(additionalCell, row.AdditionalCents);
                        SetMoneyValue(additional2Cell, row.Additional2Cents);
                        row.Status = "Atualizado";
                        updated++;
                    }
                    else
                    {
                        ClearDataInputCells(nameCell, dateCell, primaryCell, additionalCell, additional2Cell);
                    }
                }

                ValidateOriginalFormulasPreserved(formulasBefore, CaptureFormulas(layout.Document));
                ValidateDataFormulaCoverage(layout);
                ReplaceXmlEntry(archive, layout.EntryName, layout.Document);
                RemoveCalculationChain(archive);
                ForceWorkbookRecalculation(archive);

                missing.Clear();
                ambiguous.Clear();
            }

            ValidateWorkbookPackage(tempPath);
            ReplaceFileAtomically(tempPath, workbookPath);
            tempPath = null;

            return new Dictionary<string, object>
            {
                { "ok", true },
                { "updated", updated },
                { "missing", missing.ToArray() },
                { "ambiguous", ambiguous.ToArray() },
                { "workbookPath", workbookPath },
                { "writer", "openxml-direct" },
                { "insertedRows", insertedRows },
                { "sourceOfNames", "protheus" }
            };
        }
        catch (UnauthorizedAccessException ex)
        {
            throw new IOException("Não foi possível gravar o arquivo de comissões. Verifique se a planilha está aberta no Excel ou bloqueada pelo OneDrive.", ex);
        }
        catch (IOException ex)
        {
            string message = ex.Message ?? "";
            if (message.IndexOf("being used", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf("utilizado por outro processo", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf("acesso", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                throw new IOException("A planilha de comissões está bloqueada por outro processo. Feche o arquivo no Excel e execute novamente.", ex);
            }
            throw;
        }
        finally
        {
            if (!string.IsNullOrEmpty(tempPath))
            {
                try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
            }
        }
    }

    private static List<string> ReadSharedStrings(ZipArchive archive)
    {
        var values = new List<string>();
        ZipArchiveEntry entry = archive.GetEntry("xl/sharedStrings.xml");
        if (entry == null) return values;

        XDocument document = LoadXmlEntry(entry);
        foreach (XElement item in document.Root.Elements(SpreadsheetNs + "si"))
        {
            string text = string.Concat(item.Descendants(SpreadsheetNs + "t").Select(t => t.Value));
            values.Add(text ?? "");
        }
        return values;
    }

    private static Layout FindLayout(ZipArchive archive, List<string> sharedStrings)
    {
        List<string> worksheetNames = archive.Entries
            .Where(e => e.FullName.StartsWith("xl/worksheets/", StringComparison.OrdinalIgnoreCase) && e.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
            .Select(e => e.FullName)
            .ToList();

        foreach (string entryName in worksheetNames)
        {
            ZipArchiveEntry entry = archive.GetEntry(entryName);
            if (entry == null) continue;
            XDocument document = LoadXmlEntry(entry);
            XElement sheetData = document.Root.Element(SpreadsheetNs + "sheetData");
            if (sheetData == null) continue;

            List<XElement> rows = sheetData.Elements(SpreadsheetNs + "row").ToList();
            int lastRow = rows.Select(GetRowNumber).DefaultIfEmpty(0).Max();

            foreach (XElement row in rows.Take(20))
            {
                int headerRow = GetRowNumber(row);
                int nameCol = 0, dateCol = 0, primaryCol = 0, additionalCol = 0, additional2Col = 0;

                foreach (XElement cell in row.Elements(SpreadsheetNs + "c"))
                {
                    int col = GetColumnNumber(GetCellReference(cell));
                    if (col <= 0 || col > 40) continue;
                    string text = NormalizeHeader(GetCellText(cell, sharedStrings));
                    if (text == "nome") nameCol = col;
                    else if (text == "data") dateCol = col;
                    else if (text == "valor") primaryCol = col;
                    else if (text.Contains("adicional 2")) additional2Col = col;
                    else if (text.Contains("adicional")) additionalCol = col;
                }

                if (nameCol > 0 && dateCol > 0 && primaryCol > 0 && additionalCol > 0 && additional2Col > 0 &&
                    nameCol < dateCol && dateCol < primaryCol && primaryCol < additionalCol && additionalCol < additional2Col)
                {
                    int totalCol, dataStartRow, dataEndRow;
                    if (!TryFindDataRegion(document, headerRow, dateCol, primaryCol, out totalCol, out dataStartRow, out dataEndRow))
                        continue;

                    return new Layout
                    {
                        EntryName = entryName,
                        Document = document,
                        HeaderRow = headerRow,
                        NameCol = nameCol,
                        DateCol = dateCol,
                        TotalCol = totalCol,
                        PrimaryCol = primaryCol,
                        AdditionalCol = additionalCol,
                        Additional2Col = additional2Col,
                        DataStartRow = dataStartRow,
                        DataEndRow = dataEndRow,
                        LastRow = lastRow
                    };
                }
            }
        }
        return null;
    }

    private static bool TryFindDataRegion(XDocument document, int headerRow, int dateCol, int primaryCol, out int totalCol, out int dataStartRow, out int dataEndRow)
    {
        totalCol = 0;
        dataStartRow = 0;
        dataEndRow = 0;
        XElement sheetData = document.Root.Element(SpreadsheetNs + "sheetData");
        if (sheetData == null) return false;

        List<XElement> rows = sheetData.Elements(SpreadsheetNs + "row")
            .Where(r => GetRowNumber(r) > headerRow)
            .OrderBy(GetRowNumber)
            .ToList();

        foreach (XElement row in rows)
        {
            int rowNumber = GetRowNumber(row);
            XElement formulaCell = row.Elements(SpreadsheetNs + "c")
                .FirstOrDefault(c =>
                {
                    int col = GetColumnNumber(GetCellReference(c));
                    return col > dateCol && col < primaryCol && c.Element(SpreadsheetNs + "f") != null;
                });
            if (formulaCell == null) continue;

            totalCol = GetColumnNumber(GetCellReference(formulaCell));
            dataStartRow = rowNumber;
            dataEndRow = rowNumber;
            int expected = rowNumber + 1;
            foreach (XElement nextRow in rows.Where(r => GetRowNumber(r) > rowNumber))
            {
                int nextNumber = GetRowNumber(nextRow);
                if (nextNumber != expected) break;
                XElement nextFormula = FindCell(nextRow, totalCol);
                if (nextFormula == null || nextFormula.Element(SpreadsheetNs + "f") == null) break;
                dataEndRow = nextNumber;
                expected++;
            }
            return true;
        }
        return false;
    }

    private static int EnsureDataRowCapacity(Layout layout, int requiredRows)
    {
        int currentCapacity = layout.DataEndRow - layout.DataStartRow + 1;
        if (requiredRows <= currentCapacity) return 0;

        int addCount = requiredRows - currentCapacity;
        EnsureExpandableTailIsSafe(layout.Document, layout.DataEndRow);
        XElement templateRow = FindRow(layout.Document, layout.DataEndRow);
        if (templateRow == null) throw new InvalidDataException("Não foi possível localizar a última linha-modelo da tabela de comissões.");

        ShiftRowsDown(layout.Document, layout.DataEndRow, addCount);

        XElement sheetData = layout.Document.Root.Element(SpreadsheetNs + "sheetData");
        XElement insertAfter = FindRow(layout.Document, layout.DataEndRow);
        for (int i = 1; i <= addCount; i++)
        {
            int newRowNumber = layout.DataEndRow + i;
            XElement newRow = new XElement(templateRow);
            RebaseClonedRow(newRow, newRowNumber, layout);
            insertAfter.AddAfterSelf(newRow);
            insertAfter = newRow;
        }

        layout.DataEndRow += addCount;
        layout.LastRow += addCount;
        UpdateDimensionForInsertedRows(layout.Document, addCount);
        return addCount;
    }

    private static XElement FindRow(XDocument document, int rowNumber)
    {
        XElement sheetData = document.Root.Element(SpreadsheetNs + "sheetData");
        if (sheetData == null) return null;
        return sheetData.Elements(SpreadsheetNs + "row").FirstOrDefault(r => GetRowNumber(r) == rowNumber);
    }

    private static void EnsureExpandableTailIsSafe(XDocument document, int afterRow)
    {
        XElement sheetData = document.Root.Element(SpreadsheetNs + "sheetData");
        if (sheetData == null) throw new InvalidDataException("A planilha não possui sheetData.");
        bool hasFormulaBelow = sheetData.Elements(SpreadsheetNs + "row")
            .Where(r => GetRowNumber(r) > afterRow)
            .SelectMany(r => r.Elements(SpreadsheetNs + "c"))
            .Any(c => c.Element(SpreadsheetNs + "f") != null);
        if (hasFormulaBelow)
            throw new InvalidDataException("A tabela precisa crescer, mas existem fórmulas abaixo dela. A expansão foi bloqueada para não alterar cálculos externos.");
    }

    private static void ShiftRowsDown(XDocument document, int afterRow, int count)
    {
        XElement sheetData = document.Root.Element(SpreadsheetNs + "sheetData");
        if (sheetData == null) throw new InvalidDataException("A planilha não possui sheetData.");

        List<XElement> rows = sheetData.Elements(SpreadsheetNs + "row")
            .Where(r => GetRowNumber(r) > afterRow)
            .OrderByDescending(GetRowNumber)
            .ToList();

        foreach (XElement row in rows)
        {
            int newRowNumber = GetRowNumber(row) + count;
            row.SetAttributeValue("r", newRowNumber.ToString(CultureInfo.InvariantCulture));
            foreach (XElement cell in row.Elements(SpreadsheetNs + "c"))
            {
                int col = GetColumnNumber(GetCellReference(cell));
                cell.SetAttributeValue("r", ColumnName(col) + newRowNumber.ToString(CultureInfo.InvariantCulture));
            }
        }
    }

    private static void RebaseClonedRow(XElement row, int newRowNumber, Layout layout)
    {
        row.SetAttributeValue("r", newRowNumber.ToString(CultureInfo.InvariantCulture));
        foreach (XElement cell in row.Elements(SpreadsheetNs + "c"))
        {
            int col = GetColumnNumber(GetCellReference(cell));
            cell.SetAttributeValue("r", ColumnName(col) + newRowNumber.ToString(CultureInfo.InvariantCulture));

            if (col == layout.TotalCol)
            {
                CreateExplicitTotalFormula(cell, newRowNumber, layout);
            }
            else if (col == layout.NameCol || col == layout.DateCol || col == layout.PrimaryCol ||
                     col == layout.AdditionalCol || col == layout.Additional2Col)
            {
                ClearCellContent(cell);
            }
            else
            {
                XElement formula = cell.Element(SpreadsheetNs + "f");
                if (formula != null) formula.Remove();
                XElement value = cell.Element(SpreadsheetNs + "v");
                if (value != null) value.Remove();
                XElement inlineString = cell.Element(SpreadsheetNs + "is");
                if (inlineString != null) inlineString.Remove();
                XAttribute type = cell.Attribute("t");
                if (type != null) type.Remove();
            }
        }
    }

    private static void CreateExplicitTotalFormula(XElement cell, int rowNumber, Layout layout)
    {
        ClearCellContent(cell);
        string formulaText = ColumnName(layout.PrimaryCol) + rowNumber.ToString(CultureInfo.InvariantCulture) + "+" +
                             ColumnName(layout.AdditionalCol) + rowNumber.ToString(CultureInfo.InvariantCulture) + "+" +
                             ColumnName(layout.Additional2Col) + rowNumber.ToString(CultureInfo.InvariantCulture);
        cell.Add(new XElement(SpreadsheetNs + "f", formulaText));
        cell.Add(new XElement(SpreadsheetNs + "v", "0"));
    }

    private static void ClearCellContent(XElement cell)
    {
        XAttribute type = cell.Attribute("t");
        if (type != null) type.Remove();
        XElement formula = cell.Element(SpreadsheetNs + "f");
        if (formula != null) formula.Remove();
        XElement value = cell.Element(SpreadsheetNs + "v");
        if (value != null) value.Remove();
        XElement inlineString = cell.Element(SpreadsheetNs + "is");
        if (inlineString != null) inlineString.Remove();
    }

    private static void SetInlineTextValue(XElement cell, string value)
    {
        if (cell.Element(SpreadsheetNs + "f") != null)
            throw new InvalidOperationException("Tentativa de alterar uma célula de fórmula foi bloqueada.");
        ClearCellContent(cell);
        if (string.IsNullOrEmpty(value)) return;
        cell.SetAttributeValue("t", "inlineStr");
        cell.Add(new XElement(SpreadsheetNs + "is", new XElement(SpreadsheetNs + "t", value)));
    }

    private static void ClearDataInputCells(XElement nameCell, XElement dateCell, XElement primaryCell, XElement additionalCell, XElement additional2Cell)
    {
        SetInlineTextValue(nameCell, null);
        SetNumericValue(dateCell, null, true);
        SetNumericValue(primaryCell, null, true);
        SetNumericValue(additionalCell, null, true);
        SetNumericValue(additional2Cell, null, true);
    }

    private static void ValidateDataFormulaCoverage(Layout layout)
    {
        for (int rowNumber = layout.DataStartRow; rowNumber <= layout.DataEndRow; rowNumber++)
        {
            XElement row = FindRow(layout.Document, rowNumber);
            XElement totalCell = row == null ? null : FindCell(row, layout.TotalCol);
            if (totalCell == null || totalCell.Element(SpreadsheetNs + "f") == null)
                throw new InvalidDataException("A fórmula de total não foi encontrada na linha " + rowNumber.ToString(CultureInfo.InvariantCulture) + ". O arquivo não será salvo.");
        }
    }

    private static void UpdateDimensionForInsertedRows(XDocument document, int insertedRows)
    {
        XElement dimension = document.Root.Element(SpreadsheetNs + "dimension");
        if (dimension == null || insertedRows <= 0) return;
        string reference = (string)dimension.Attribute("ref") ?? "";
        Match match = Regex.Match(reference, @"^([A-Z]+)(\d+):([A-Z]+)(\d+)$", RegexOptions.IgnoreCase);
        if (!match.Success) return;
        int lastRow;
        if (!int.TryParse(match.Groups[4].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out lastRow)) return;
        dimension.SetAttributeValue("ref", match.Groups[1].Value + match.Groups[2].Value + ":" + match.Groups[3].Value + (lastRow + insertedRows).ToString(CultureInfo.InvariantCulture));
    }

    private static Dictionary<string, List<int>> BuildNameIndex(Layout layout, List<string> sharedStrings)
    {
        var index = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
        XElement sheetData = layout.Document.Root.Element(SpreadsheetNs + "sheetData");
        if (sheetData == null) return index;

        foreach (XElement row in sheetData.Elements(SpreadsheetNs + "row"))
        {
            int rowNumber = GetRowNumber(row);
            if (rowNumber <= layout.HeaderRow || rowNumber > layout.LastRow) continue;
            XElement cell = FindCell(row, layout.NameCol);
            if (cell == null) continue;
            string name = GetCellText(cell, sharedStrings).Trim();
            if (name.Length == 0) continue;
            string key = NormalizeName(name);
            List<int> list;
            if (!index.TryGetValue(key, out list))
            {
                list = new List<int>();
                index[key] = list;
            }
            list.Add(rowNumber);
        }
        return index;
    }

    private static XElement GetOrCreateCell(XDocument document, int rowNumber, int columnNumber)
    {
        XElement sheetData = document.Root.Element(SpreadsheetNs + "sheetData");
        if (sheetData == null) throw new InvalidDataException("A planilha não possui sheetData.");

        XElement row = sheetData.Elements(SpreadsheetNs + "row").FirstOrDefault(r => GetRowNumber(r) == rowNumber);
        if (row == null)
        {
            row = new XElement(SpreadsheetNs + "row", new XAttribute("r", rowNumber));
            XElement nextRow = sheetData.Elements(SpreadsheetNs + "row").FirstOrDefault(r => GetRowNumber(r) > rowNumber);
            if (nextRow != null) nextRow.AddBeforeSelf(row); else sheetData.Add(row);
        }

        XElement existing = FindCell(row, columnNumber);
        if (existing != null) return existing;

        string cellRef = ColumnName(columnNumber) + rowNumber.ToString(CultureInfo.InvariantCulture);
        XElement cell = new XElement(SpreadsheetNs + "c", new XAttribute("r", cellRef));
        XElement next = row.Elements(SpreadsheetNs + "c").FirstOrDefault(c => GetColumnNumber(GetCellReference(c)) > columnNumber);
        if (next != null) next.AddBeforeSelf(cell); else row.Add(cell);
        return cell;
    }

    private static XElement FindCell(XElement row, int columnNumber)
    {
        return row.Elements(SpreadsheetNs + "c").FirstOrDefault(c => GetColumnNumber(GetCellReference(c)) == columnNumber);
    }

    private static void EnsureWritableInputCell(XElement cell, string field, string name)
    {
        if (cell.Element(SpreadsheetNs + "f") != null)
            throw new InvalidOperationException("Segurança: a célula de " + field + " de " + name + " contém fórmula e não será sobrescrita.");
    }

    private static void SetMoneyValue(XElement cell, long cents)
    {
        if (cents == 0)
        {
            SetNumericValue(cell, null, true);
            return;
        }
        decimal value = ((decimal)cents) / 100m;
        SetNumericValue(cell, value.ToString("0.00", CultureInfo.InvariantCulture), false);
    }

    private static void SetNumericValue(XElement cell, string value, bool blank)
    {
        XAttribute type = cell.Attribute("t");
        if (type != null) type.Remove();
        XElement inlineString = cell.Element(SpreadsheetNs + "is");
        if (inlineString != null) inlineString.Remove();

        XElement formula = cell.Element(SpreadsheetNs + "f");
        if (formula != null) throw new InvalidOperationException("Tentativa de alterar uma célula de fórmula foi bloqueada.");

        XElement current = cell.Element(SpreadsheetNs + "v");
        if (blank)
        {
            if (current != null) current.Remove();
            return;
        }

        if (current == null)
        {
            current = new XElement(SpreadsheetNs + "v");
            cell.Add(current);
        }
        current.Value = value ?? "";
    }

    private static List<FormulaSnapshot> CaptureFormulas(XDocument document)
    {
        return document.Descendants(SpreadsheetNs + "c")
            .Where(c => c.Element(SpreadsheetNs + "f") != null)
            .Select(c => new FormulaSnapshot
            {
                CellRef = GetCellReference(c),
                FormulaXml = c.Element(SpreadsheetNs + "f").ToString(SaveOptions.DisableFormatting)
            })
            .OrderBy(f => f.CellRef, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static void ValidateOriginalFormulasPreserved(List<FormulaSnapshot> before, List<FormulaSnapshot> after)
    {
        var afterByCell = after.ToDictionary(f => f.CellRef, StringComparer.OrdinalIgnoreCase);
        foreach (FormulaSnapshot original in before)
        {
            FormulaSnapshot current;
            if (!afterByCell.TryGetValue(original.CellRef, out current) ||
                !string.Equals(original.FormulaXml, current.FormulaXml, StringComparison.Ordinal))
            {
                throw new InvalidDataException("A validação de segurança detectou alteração em fórmula original da célula " + original.CellRef + ". O arquivo não será salvo.");
            }
        }
    }

    private static void RemoveCalculationChain(ZipArchive archive)
    {
        ZipArchiveEntry calcChain = archive.GetEntry("xl/calcChain.xml");
        if (calcChain != null) calcChain.Delete();

        ZipArchiveEntry relsEntry = archive.GetEntry("xl/_rels/workbook.xml.rels");
        if (relsEntry != null)
        {
            XDocument rels = LoadXmlEntry(relsEntry);
            List<XElement> calcRelationships = rels.Root.Elements()
                .Where(e => (((string)e.Attribute("Type")) ?? "").EndsWith("/calcChain", StringComparison.OrdinalIgnoreCase))
                .ToList();
            foreach (XElement relationship in calcRelationships) relationship.Remove();
            ReplaceXmlEntry(archive, "xl/_rels/workbook.xml.rels", rels);
        }

        ZipArchiveEntry contentTypesEntry = archive.GetEntry("[Content_Types].xml");
        if (contentTypesEntry != null)
        {
            XDocument contentTypes = LoadXmlEntry(contentTypesEntry);
            List<XElement> overrides = contentTypes.Root.Elements()
                .Where(e => string.Equals(((string)e.Attribute("PartName")) ?? "", "/xl/calcChain.xml", StringComparison.OrdinalIgnoreCase))
                .ToList();
            foreach (XElement item in overrides) item.Remove();
            ReplaceXmlEntry(archive, "[Content_Types].xml", contentTypes);
        }
    }

    private static void ForceWorkbookRecalculation(ZipArchive archive)
    {
        ZipArchiveEntry entry = archive.GetEntry("xl/workbook.xml");
        if (entry == null) return;
        XDocument document = LoadXmlEntry(entry);
        XElement calcPr = document.Root.Element(SpreadsheetNs + "calcPr");
        if (calcPr == null)
        {
            calcPr = new XElement(SpreadsheetNs + "calcPr");
            document.Root.Add(calcPr);
        }
        calcPr.SetAttributeValue("calcMode", "auto");
        calcPr.SetAttributeValue("fullCalcOnLoad", "1");
        calcPr.SetAttributeValue("forceFullCalc", "1");
        ReplaceXmlEntry(archive, "xl/workbook.xml", document);
    }

    private static void ReplaceXmlEntry(ZipArchive archive, string entryName, XDocument document)
    {
        ZipArchiveEntry oldEntry = archive.GetEntry(entryName);
        DateTimeOffset timestamp = oldEntry != null ? oldEntry.LastWriteTime : DateTimeOffset.Now;
        if (oldEntry != null) oldEntry.Delete();
        ZipArchiveEntry newEntry = archive.CreateEntry(entryName, CompressionLevel.Optimal);
        try { newEntry.LastWriteTime = timestamp; } catch { }
        using (Stream stream = newEntry.Open())
        {
            document.Save(stream, SaveOptions.DisableFormatting);
        }
    }

    private static XDocument LoadXmlEntry(ZipArchiveEntry entry)
    {
        using (Stream stream = entry.Open())
        {
            return XDocument.Load(stream, LoadOptions.PreserveWhitespace);
        }
    }

    private static void ValidateWorkbookPackage(string path)
    {
        using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read, false))
        {
            if (archive.GetEntry("[Content_Types].xml") == null || archive.GetEntry("xl/workbook.xml") == null)
                throw new InvalidDataException("O arquivo XLSX resultante não possui uma estrutura Office válida.");

            foreach (ZipArchiveEntry entry in archive.Entries.Where(e => e.FullName.StartsWith("xl/worksheets/", StringComparison.OrdinalIgnoreCase) && e.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)))
            {
                LoadXmlEntry(entry);
            }
        }
    }

    private static void ReplaceFileAtomically(string tempPath, string workbookPath)
    {
        try
        {
            File.Replace(tempPath, workbookPath, null);
        }
        catch (PlatformNotSupportedException)
        {
            File.Copy(tempPath, workbookPath, true);
            File.Delete(tempPath);
        }
    }

    private static string GetCellText(XElement cell, List<string> sharedStrings)
    {
        if (cell == null) return "";
        string type = (string)cell.Attribute("t") ?? "";
        if (type == "s")
        {
            int index;
            string raw = (string)cell.Element(SpreadsheetNs + "v") ?? "";
            if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out index) && index >= 0 && index < sharedStrings.Count)
                return sharedStrings[index] ?? "";
            return "";
        }
        if (type == "inlineStr")
            return string.Concat(cell.Descendants(SpreadsheetNs + "t").Select(t => t.Value));
        return (string)cell.Element(SpreadsheetNs + "v") ?? "";
    }

    private static int GetRowNumber(XElement row)
    {
        int value;
        return int.TryParse((string)row.Attribute("r"), NumberStyles.Integer, CultureInfo.InvariantCulture, out value) ? value : 0;
    }

    private static string GetCellReference(XElement cell)
    {
        return (string)cell.Attribute("r") ?? "";
    }

    private static int GetColumnNumber(string cellReference)
    {
        if (string.IsNullOrEmpty(cellReference)) return 0;
        int value = 0;
        foreach (char ch in cellReference)
        {
            if (!char.IsLetter(ch)) break;
            value = value * 26 + (char.ToUpperInvariant(ch) - 'A' + 1);
        }
        return value;
    }

    private static string ColumnName(int columnNumber)
    {
        var sb = new StringBuilder();
        int n = columnNumber;
        while (n > 0)
        {
            n--;
            sb.Insert(0, (char)('A' + (n % 26)));
            n /= 26;
        }
        return sb.ToString();
    }

    private static List<ExportRow> ParseRows(Dictionary<string, object> request)
    {
        var result = new List<ExportRow>();
        object raw;
        if (!request.TryGetValue("rows", out raw) || raw == null) return result;
        IEnumerable enumerable = raw as IEnumerable;
        if (enumerable == null) return result;

        foreach (object item in enumerable)
        {
            var dict = item as Dictionary<string, object>;
            if (dict == null)
            {
                var generic = item as IDictionary<string, object>;
                if (generic != null) dict = new Dictionary<string, object>(generic);
            }
            if (dict == null) continue;
            string name = GetString(dict, "name").Trim();
            if (name.Length == 0) continue;
            result.Add(new ExportRow
            {
                Name = name,
                PrimaryCents = GetLong(dict, "primaryCents"),
                AdditionalCents = GetLong(dict, "additionalCents"),
                Additional2Cents = GetLong(dict, "additional2Cents"),
                Status = "Pendente"
            });
        }
        return result.OrderBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    private static string NormalizeHeader(string value)
    {
        string s = (value ?? "").Trim().ToLowerInvariant();
        return Regex.Replace(s, @"\s+", " ");
    }

    private static string NormalizeName(string value)
    {
        string formD = (value ?? "").Trim().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (char ch in formD)
        {
            UnicodeCategory category = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (category != UnicodeCategory.NonSpacingMark) sb.Append(ch);
        }
        string normalized = sb.ToString().Normalize(NormalizationForm.FormC).ToUpperInvariant();
        return Regex.Replace(normalized, @"\s+", " ").Trim();
    }

    private static string GetString(IDictionary<string, object> dict, string key)
    {
        object value;
        return dict != null && dict.TryGetValue(key, out value) && value != null ? Convert.ToString(value, CultureInfo.InvariantCulture) ?? "" : "";
    }

    private static long GetLong(IDictionary<string, object> dict, string key)
    {
        object value;
        if (dict == null || !dict.TryGetValue(key, out value) || value == null) return 0;
        long result;
        if (long.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out result)) return result;
        double d;
        if (double.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out d)) return Convert.ToInt64(Math.Round(d));
        return 0;
    }

    private static Dictionary<string, object> ReadNativeMessage()
    {
        Stream input = Console.OpenStandardInput();
        byte[] lengthBytes = ReadExact(input, 4);
        if (lengthBytes == null) throw new EndOfStreamException("Mensagem nativa vazia.");
        int length = BitConverter.ToInt32(lengthBytes, 0);
        if (length <= 0 || length > 16 * 1024 * 1024) throw new InvalidDataException("Tamanho de mensagem nativa inválido.");
        byte[] data = ReadExact(input, length);
        if (data == null) throw new EndOfStreamException("Mensagem nativa incompleta.");
        string json = Encoding.UTF8.GetString(data);
        var serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = 16 * 1024 * 1024;
        return serializer.Deserialize<Dictionary<string, object>>(json);
    }

    private static void WriteNativeMessage(Dictionary<string, object> response)
    {
        var serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = 16 * 1024 * 1024;
        byte[] payload = Encoding.UTF8.GetBytes(serializer.Serialize(response));
        byte[] length = BitConverter.GetBytes(payload.Length);
        Stream output = Console.OpenStandardOutput();
        output.Write(length, 0, length.Length);
        output.Write(payload, 0, payload.Length);
        output.Flush();
    }

    private static byte[] ReadExact(Stream stream, int count)
    {
        byte[] buffer = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int read = stream.Read(buffer, offset, count - offset);
            if (read <= 0) return offset == 0 ? null : buffer.Take(offset).ToArray();
            offset += read;
        }
        return buffer;
    }
}
